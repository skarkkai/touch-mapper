/* Shared by the OSM pruner and the browser; see doc/map-description-model-schema.md. */
(function(root) {
  "use strict";

  // Keep only usable name tags, preserving every input language.
  function candidates(tags) {
    const result = {};
    Object.keys(tags || {}).sort().forEach(function(key) {
      if (key === "name" || key.indexOf("name:") === 0 || key === "loc_name" || key === "short_name") {
        const value = tags[key];
        if (typeof value === "string" && value.trim()) result[key] = value.trim();
      }
    });
    return result;
  }

  // Locale affects the displayed name, never whether a feature is named.
  function resolve(tags, locale) {
    const names = candidates(tags);
    const keys = Object.keys(names).filter(function(key) { return key.indexOf("name:") === 0; }).sort();
    const language = (locale || "").trim().toLowerCase();
    if (language) {
      const base = language.split("-")[0];
      for (const code of [language, base]) {
        if (names["name:" + code]) return names["name:" + code];
      }
      const regional = keys.find(function(key) { return key.indexOf("name:" + base + "-") === 0; });
      if (regional) return names[regional];
    }
    return names.name || (keys.length ? names[keys[0]] : null) || names.loc_name || names.short_name || null;
  }

  const api = { candidates: candidates, resolve: resolve };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TMRoadNames = api;
})(typeof window !== "undefined" ? window : this);
