import type { Photo } from "@legwork/shared";
import type { Session } from "./session";

/** The requests a job start needs, passed in so the logic can be tested without a network. */
export type StartDeps = {
  create: (description: string) => Promise<Session>;
  upload: (s: Session, file: File) => Promise<Photo>;
  removePhoto: (s: Session, photo: Photo) => Promise<unknown>;
  describe: (s: Session, description: string) => Promise<unknown>;
};

export type Prepared = {
  session: Session;
  photos: Photo[];
  /** Photos that didn't upload, with why. Empty when they all made it. */
  failed: Map<File, string>;
};

/**
 * The job being started from the homepage (#67). Photos upload to it as soon
 * as they're added, and it lives until intake begins, so a retry after any
 * failure reuses the same job (never a second one) and only re-sends the
 * photos that didn't make it.
 */
export class JobDraft {
  private session: Promise<Session> | null = null;
  /** The description the job holds on the server. */
  private described = "";
  private uploads = new Map<File, Promise<Photo>>();

  constructor(private deps: StartDeps) {}

  /** The draft job, created on first use. A failed create is forgotten, so the next call tries again. */
  private ensureSession(description: string): Promise<Session> {
    if (this.session) return this.session;
    const created = this.deps.create(description);
    this.session = created;
    this.described = description;
    created.catch(() => {
      if (this.session === created) this.session = null;
    });
    return created;
  }

  /** The draft job for a start. One made earlier (for photos) that failed is made again, once. */
  private async startSession(description: string): Promise<Session> {
    const earlier = this.session;
    try {
      return await this.ensureSession(description);
    } catch (e) {
      if (!earlier) throw e;
      if (this.session === earlier) this.session = null;
      return this.ensureSession(description);
    }
  }

  private send(file: File): Promise<Photo> {
    const upload = this.ensureSession("").then((s) => this.deps.upload(s, file));
    upload.catch(() => {});
    this.uploads.set(file, upload);
    return upload;
  }

  /** Starts uploading a photo the customer just added. */
  attach(file: File): void {
    if (!this.uploads.has(file)) void this.send(file);
  }

  /** Uploads a photo again after it failed. Resolves once it's up; rejects if it fails again. */
  async retry(file: File): Promise<void> {
    await this.send(file);
  }

  /** Forgets a photo, deleting it from the job if it already uploaded. */
  remove(file: File): void {
    const upload = this.uploads.get(file);
    if (!upload) return;
    this.uploads.delete(file);
    const session = this.session;
    if (!session) return;
    void Promise.all([session, upload])
      .then(([s, photo]) => this.deps.removePhoto(s, photo))
      .catch(() => {});
  }

  /**
   * Makes sure the job exists with every photo in `files` (uploading any that
   * failed or never started) and, once they're all up, `description`. Throws
   * if the job or description request fails; a photo that fails is reported
   * in `failed` instead, and the description waits until there are none.
   */
  async prepare(description: string, files: File[]): Promise<Prepared> {
    const session = await this.startSession(description);
    const settled = await Promise.allSettled(
      files.map(async (file) => {
        const earlier = this.uploads.get(file);
        if (earlier) {
          try {
            return await earlier;
          } catch {
            // Fall through and send it again.
          }
        }
        return this.send(file);
      }),
    );
    const photos: Photo[] = [];
    const failed = new Map<File, string>();
    settled.forEach((r, i) => {
      if (r.status === "fulfilled") photos.push(r.value);
      else failed.set(files[i]!, r.reason instanceof Error ? r.reason.message : "Upload failed.");
    });
    if (failed.size === 0 && description !== this.described) {
      await this.deps.describe(session, description);
      this.described = description;
    }
    return { session, photos, failed };
  }
}
