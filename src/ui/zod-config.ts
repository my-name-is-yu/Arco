import { z } from "zod";

// Configure before importing SDKs: some SDK module initializers parse schemas.
// Keep validation interpreted so the iframe never requires unsafe-eval.
z.config({ jitless: true });
