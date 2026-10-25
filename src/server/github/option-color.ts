import { z } from "zod";

const colors = new Set([
  "gray",
  "blue",
  "green",
  "yellow",
  "orange",
  "red",
  "pink",
  "purple",
]);

export const optionColorSchema = z
  .unknown()
  .optional()
  .transform((color) =>
    typeof color === "string" && colors.has(color.toLowerCase())
      ? color
      : undefined,
  );
