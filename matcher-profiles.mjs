const PROFILE_CHUNK_MAX_CHARS = 1400;

export function buildVenueProfileChunks(conference) {
  const venueName = `${conference.name} (${conference.acronym || "conference"})`;
  const areaLabels = (conference.areas || []).map(toTitle);
  const overview = [
    `${venueName}.`,
    conference.description,
    areaLabels.length ? `Research areas: ${areaLabels.join(", ")}.` : "",
    conference.topics?.length ? `Topics: ${conference.topics.join(", ")}.` : "",
    conference.keywords?.length ? `Keywords: ${conference.keywords.join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const chunks = overview ? [overview] : [];
  const cfpTopics = (conference.cfp_topics || []).map(clean).filter(Boolean);
  let topicGroup = [];

  cfpTopics.forEach((topic) => {
    const candidate = buildCfpChunk(venueName, [...topicGroup, topic]);
    if (topicGroup.length && candidate.length > PROFILE_CHUNK_MAX_CHARS) {
      chunks.push(buildCfpChunk(venueName, topicGroup));
      topicGroup = [topic];
    } else {
      topicGroup.push(topic);
    }
  });

  if (topicGroup.length) {
    chunks.push(buildCfpChunk(venueName, topicGroup));
  }

  return [...new Set(chunks)];
}

export function fingerprintVenueProfiles(conferences) {
  const source = conferences
    .map((conference) => `${conference.id}\n${buildVenueProfileChunks(conference).join("\n---\n")}`)
    .join("\n===\n");
  return `fnv1a-${fnv1a(source)}`;
}

function buildCfpChunk(venueName, topics) {
  return `${venueName}. Call for papers topics: ${topics.join("; ")}.`;
}

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function clean(value) {
  return String(value || "").trim();
}

function toTitle(value) {
  return String(value || "")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
