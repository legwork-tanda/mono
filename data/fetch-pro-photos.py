#!/usr/bin/env python3
"""
Fetches the profile photos for the 40 mock Pros and writes them into
apps/web/public/photos/pros/<tradie-id>.jpg, square and grayscale like the
other photos in public/photos.

Source is the English Wikipedia lead image for each person, which for living
people is always a freely licensed file (Wikimedia Commons). The licence and
the file page are recorded in apps/web/public/photos/pros/CREDITS.txt, which is
what CC BY / CC BY-SA attribution requires.

  env -u PYTHONPATH /opt/homebrew/bin/python3 data/fetch-pro-photos.py

Re-runnable: skips any photo already on disk unless --force is passed, and the
Wikimedia API calls are batched (they rate-limit fast when hammered one by one).
"""

from __future__ import annotations

import io
import json
import pathlib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "apps" / "web" / "public" / "photos" / "pros"
SIZE = 480
UA = "legwork-demo-data/1.0 (hackathon mock data; nathan@legwork.demo)"
WP = "https://en.wikipedia.org/w/api.php"
COMMONS = "https://commons.wikimedia.org/w/api.php"

# tradie id -> the actor whose Wikipedia lead photo stands in for them.
CAST = {
    "tradie-01": "Dev Patel",
    "tradie-02": "Gemma Chan",
    "tradie-03": "Russell Crowe",
    "tradie-04": "Priyanka Chopra",
    "tradie-05": "Tom Holland",
    "tradie-06": "Milla Jovovich",
    "tradie-07": "Ryan Reynolds",
    "tradie-08": "Mindy Kaling",
    "tradie-09": "Timothée Chalamet",
    "tradie-10": "Michelle Yeoh",
    "tradie-11": "Stanley Tucci",
    "tradie-12": "Sandra Oh",
    "tradie-13": "Liam Neeson",
    "tradie-14": "Chris Hemsworth",
    "tradie-15": "Freida Pinto",
    "tradie-16": "Chris Evans (actor)",
    "tradie-17": "Awkwafina",
    "tradie-18": "Oscar Isaac",
    "tradie-19": "Margot Robbie",
    "tradie-20": "Hugh Jackman",
    "tradie-21": "Alexandra Daddario",
    "tradie-22": "Ryan Gosling",
    "tradie-23": "Leonardo DiCaprio",
    "tradie-24": "Isla Fisher",
    "tradie-25": "Tom Hardy",
    "tradie-26": "Zendaya",
    "tradie-27": "Jason Momoa",
    "tradie-28": "Ana de Armas",
    "tradie-29": "Idris Elba",
    "tradie-30": "Keanu Reeves",
    "tradie-31": "Rami Malek",
    "tradie-32": "Inde Navarrette",
    "tradie-33": "Marisa Tomei",
    "tradie-34": "Channing Tatum",
    "tradie-35": "Kumail Nanjiani",
    "tradie-36": "Jake Gyllenhaal",
    "tradie-37": "Rose Byrne",
    "tradie-38": "Wagner Moura",
    "tradie-39": "Sydney Sweeney",
    "tradie-40": "Dwayne Johnson",
}

RESAMPLE = getattr(Image, "Resampling", Image).LANCZOS


def get_json(url: str) -> dict:
    """GET with backoff. The Wikimedia APIs rate-limit hard, so callers batch."""
    last: Exception | None = None
    for attempt in range(6):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as exc:
            last = exc
            if exc.code not in (429, 503):
                raise
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"rate limited after retries: {last}")


def chunks(items: list[str], n: int = 15) -> list[list[str]]:
    return [items[i : i + n] for i in range(0, len(items), n)]


def lead_images(people: list[str]) -> dict[str, dict]:
    """person -> {url, file} for their Wikipedia lead image, batched by title."""
    found: dict[str, dict] = {}
    for group in chunks(people):
        q = urllib.parse.urlencode(
            {
                "action": "query",
                "titles": "|".join(group),
                "prop": "pageimages",
                "piprop": "thumbnail|name",
                "pithumbsize": str(SIZE * 3),
                "redirects": "1",
                "format": "json",
            }
        )
        data = get_json(f"{WP}?{q}")
        # `normalized`/`redirects` map what we asked for onto the page title.
        alias = {person: person for person in group}
        for entry in data["query"].get("normalized", []) + data["query"].get("redirects", []):
            for person in group:
                if alias[person] == entry["from"]:
                    alias[person] = entry["to"]
        by_title = {p.get("title"): p for p in data["query"]["pages"].values()}
        for person in group:
            page = by_title.get(alias[person], {})
            if "thumbnail" in page:
                found[person] = {"url": page["thumbnail"]["source"], "file": page.get("pageimage", "")}
        time.sleep(1.5)
    return found


def licences(files: list[str]) -> dict[str, str]:
    """Commons file title -> 'licence · author · file page'."""
    out: dict[str, str] = {}
    for group in chunks([f for f in files if f]):
        q = urllib.parse.urlencode(
            {
                "action": "query",
                "titles": "|".join(f"File:{f}" for f in group),
                "prop": "imageinfo",
                "iiprop": "extmetadata|url",
                "format": "json",
            }
        )
        data = get_json(f"{COMMONS}?{q}")
        for page in data["query"]["pages"].values():
            info = (page.get("imageinfo") or [{}])[0]
            meta = info.get("extmetadata", {})
            name = meta.get("LicenseShortName", {}).get("value", "unknown")
            artist = meta.get("Artist", {}).get("value", "")
            artist = artist.replace("<", " <").split("<")[0].strip() or "unknown"
            title = page.get("title", "").removeprefix("File:")
            out[title] = f"{name} · {artist} · {info.get('descriptionurl', '')}".strip()
        time.sleep(1.5)
    return out


def square(img: Image.Image) -> Image.Image:
    """Crop to a square, biased towards the top third where faces sit."""
    w, h = img.size
    side = min(w, h)
    left = (w - side) // 2
    top = int((h - side) * 0.18)
    return img.crop((left, top, left + side, top + side))


def download(url: str) -> Image.Image:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return Image.open(io.BytesIO(r.read())).convert("RGB")


def main() -> int:
    force = "--force" in sys.argv
    OUT.mkdir(parents=True, exist_ok=True)

    todo = {tid: person for tid, person in CAST.items() if force or not (OUT / f"{tid}.jpg").exists()}
    # Lead images and licences are looked up for the whole cast, not just the
    # photos being fetched, so CREDITS.txt stays complete on a partial rerun.
    leads = lead_images(sorted(set(CAST.values())))
    lic = licences(sorted({lead["file"] for lead in leads.values()}))

    failures: list[str] = []
    for tid, person in todo.items():
        lead = leads.get(person)
        if not lead:
            failures.append(f"{tid} {person}: no Wikipedia lead image")
            continue
        try:
            img = download(lead["url"])
            img = square(img).resize((SIZE, SIZE), RESAMPLE).convert("L")
            dest = OUT / f"{tid}.jpg"
            img.save(dest, "JPEG", quality=84, optimize=True, progressive=True)
            print(f"ok   {tid} {person:22} {dest.stat().st_size // 1024} kB")
        except Exception as exc:  # noqa: BLE001 - report and keep going
            failures.append(f"{tid} {person}: {exc}")

    # CREDITS.txt is rebuilt from whatever is on disk, so a partial run is honest.
    lines = []
    for tid, person in CAST.items():
        if not (OUT / f"{tid}.jpg").exists():
            continue
        lead = leads.get(person)
        # pageimage gives underscores; the API returns titles with spaces.
        entry = lic.get(lead["file"].replace("_", " "), "licence lookup failed") if lead else "lead image lookup failed"
        lines.append(f"{tid}.jpg  {person}  {entry}")
    header = (
        "Profile photos for the 40 mock Pros. Each is the English Wikipedia lead\n"
        "image for the named actor, cropped square and converted to grayscale.\n"
        "Living people's Wikipedia lead images are freely licensed, so every file\n"
        "here is CC BY, CC BY-SA or public domain. Attribution, per file, below.\n"
        "These are mock records: no actor has any connection to Legwork.\n\n"
    )
    (OUT / "CREDITS.txt").write_text(header + "\n".join(lines) + "\n")

    if failures:
        print("\n%d failed:\n  %s" % (len(failures), "\n  ".join(failures)))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
