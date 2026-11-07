// Trailers that an addon serves as a plain video file play in the app's own
// <video> element, with no YouTube player and so no YouTube ads. Prefer them
// and keep YouTube as the fallback.
const DIRECT_VIDEO_PATTERN = /^https?:\/\/[^\s]+\.(mp4|m4v|webm|m3u8|mpd)(?:[?#]|$)/i;

export function resolveDirectTrailerUrl(entry) {
  if (!entry) {
    return "";
  }
  const candidates =
    typeof entry === "string"
      ? [entry]
      : [entry.url, entry.externalUrl, entry.source, entry.link, entry.src];
  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (DIRECT_VIDEO_PATTERN.test(value)) {
      return value;
    }
  }
  return "";
}

export function findDirectTrailerSource(meta = {}) {
  const entries = [
    ...(Array.isArray(meta?.trailers) ? meta.trailers : []),
    ...(Array.isArray(meta?.trailerStreams) ? meta.trailerStreams : [])
  ];
  for (const entry of entries) {
    const url = resolveDirectTrailerUrl(entry);
    if (url) {
      return { kind: "video", url };
    }
  }
  return null;
}
