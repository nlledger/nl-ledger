import { createHash } from "node:crypto";

// Public URLs depend only on the PNG, independently of the render cache key.
export const cardImageName = (png) =>
  `/share/static/${createHash("sha256").update(png).digest("hex")}.png`;
