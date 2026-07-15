import { readFile, writeFile } from "node:fs/promises";
import { pipeline } from "@huggingface/transformers";
import { buildVenueProfileChunks, fingerprintVenueProfiles } from "../matcher-profiles.mjs";

const MODEL = "Xenova/bge-small-en-v1.5";
const DATA_PATH = new URL("../data/conferences.json", import.meta.url);
const OUTPUT_PATH = new URL("../data/venue-embeddings.json", import.meta.url);

const payload = JSON.parse(await readFile(DATA_PATH, "utf8"));
const venues = payload.conferences.map((conference) => ({
  id: conference.id,
  chunks: buildVenueProfileChunks(conference),
}));
const flatChunks = venues.flatMap((venue) => venue.chunks);

console.log(`Loading ${MODEL} and embedding ${flatChunks.length} venue-profile chunks...`);
const embedder = await pipeline("feature-extraction", MODEL, { dtype: "q8" });
const tensor = await embedder(flatChunks, { pooling: "cls", normalize: true });
const flatEmbeddings = tensor.tolist().map((embedding) => embedding.map((value) => Number(value.toFixed(7))));

let offset = 0;
const embeddingsByVenue = Object.fromEntries(
  venues.map((venue) => {
    const embeddings = flatEmbeddings.slice(offset, offset + venue.chunks.length);
    offset += venue.chunks.length;
    return [venue.id, embeddings];
  }),
);

const artifact = {
  schema_version: 1,
  model: MODEL,
  pooling: "cls",
  normalized: true,
  profiles_fingerprint: fingerprintVenueProfiles(payload.conferences),
  generated_at: new Date().toISOString(),
  venues: embeddingsByVenue,
};

await writeFile(OUTPUT_PATH, `${JSON.stringify(artifact)}\n`, "utf8");
console.log(`Wrote embeddings for ${venues.length} venues to data/venue-embeddings.json.`);
