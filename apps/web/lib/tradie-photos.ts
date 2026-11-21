// Photos for the mock Pros.
//
// The 40 seeded tradies share their ids across every seed (D1, Supabase), but
// their photos are not in the database: they are mock data for the demo, so
// they live with the web app's other photos and are looked up by id. A tradie
// with no entry (every live tradie played through /tradie) keeps the initials
// circle, which is the design's documented fallback.
//
// Files: apps/web/public/photos/pros/<id>.jpg, square, grayscale, 480px.
// Where each one came from, and its licence: see photos/pros/CREDITS.txt.
// Regenerate them all: `env -u PYTHONPATH /opt/homebrew/bin/python3 data/fetch-pro-photos.py`

const PRO_PHOTOS: Record<string, string> = {
  "tradie-01": "/photos/pros/tradie-01.jpg",
  "tradie-02": "/photos/pros/tradie-02.jpg",
  "tradie-03": "/photos/pros/tradie-03.jpg",
  "tradie-04": "/photos/pros/tradie-04.jpg",
  "tradie-05": "/photos/pros/tradie-05.jpg",
  "tradie-06": "/photos/pros/tradie-06.jpg",
  "tradie-07": "/photos/pros/tradie-07.jpg",
  "tradie-08": "/photos/pros/tradie-08.jpg",
  "tradie-09": "/photos/pros/tradie-09.jpg",
  "tradie-10": "/photos/pros/tradie-10.jpg",
  "tradie-11": "/photos/pros/tradie-11.jpg",
  "tradie-12": "/photos/pros/tradie-12.jpg",
  "tradie-13": "/photos/pros/tradie-13.jpg",
  "tradie-14": "/photos/pros/tradie-14.jpg",
  "tradie-15": "/photos/pros/tradie-15.jpg",
  "tradie-16": "/photos/pros/tradie-16.jpg",
  "tradie-17": "/photos/pros/tradie-17.jpg",
  "tradie-18": "/photos/pros/tradie-18.jpg",
  "tradie-19": "/photos/pros/tradie-19.jpg",
  "tradie-20": "/photos/pros/tradie-20.jpg",
  "tradie-21": "/photos/pros/tradie-21.jpg",
  "tradie-22": "/photos/pros/tradie-22.jpg",
  "tradie-23": "/photos/pros/tradie-23.jpg",
  "tradie-24": "/photos/pros/tradie-24.jpg",
  "tradie-25": "/photos/pros/tradie-25.jpg",
  "tradie-26": "/photos/pros/tradie-26.jpg",
  "tradie-27": "/photos/pros/tradie-27.jpg",
  "tradie-28": "/photos/pros/tradie-28.jpg",
  "tradie-29": "/photos/pros/tradie-29.jpg",
  "tradie-30": "/photos/pros/tradie-30.jpg",
  "tradie-31": "/photos/pros/tradie-31.jpg",
  "tradie-32": "/photos/pros/tradie-32.jpg",
  "tradie-33": "/photos/pros/tradie-33.jpg",
  "tradie-34": "/photos/pros/tradie-34.jpg",
  "tradie-35": "/photos/pros/tradie-35.jpg",
  "tradie-36": "/photos/pros/tradie-36.jpg",
  "tradie-37": "/photos/pros/tradie-37.jpg",
  "tradie-38": "/photos/pros/tradie-38.jpg",
  "tradie-39": "/photos/pros/tradie-39.jpg",
  "tradie-40": "/photos/pros/tradie-40.jpg",
};

/** The mock Pro's photo, or null: then the initials circle stands in. */
export const proPhoto = (tradieId: string): string | null => PRO_PHOTOS[tradieId] ?? null;
