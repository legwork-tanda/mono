export class JobServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** The seeded demo user is missing, usually because the seed hasn't been applied. */
export class DemoUserMissingError extends JobServiceError {
  constructor() {
    super("The demo user is not in the database. Run `npm run db:push` to apply the seed.");
  }
}

/** The caller passed input that breaks a business rule. */
export class ValidationError extends JobServiceError {}

export class JobNotFoundError extends JobServiceError {
  constructor(jobId: string) {
    super(`Job ${jobId} was not found.`);
  }
}
