"use strict";

function lineText(line) {
  if (!line || !Array.isArray(line.parts)) {
    return "";
  }
  return line.parts.map(function(part) {
    return part && part.text !== undefined && part.text !== null ? String(part.text) : "";
  }).join("").replace(/\s+/g, " ").trim();
}

function pushSection(lines, label, section) {
  const count = section && Number.isFinite(Number(section.count)) ? Number(section.count) : 0;
  lines.push("- " + label + " (" + count + ")");
  const items = section && Array.isArray(section.items) ? section.items : [];
  const itemPrefix = label === "Ways" ? "Way" : "Building";

  items.forEach(function(item, index) {
    lines.push("  - " + itemPrefix + " " + (index + 1));
    const modelLines = item && Array.isArray(item.lines) ? item.lines : [];
    modelLines.forEach(function(modelLine) {
      const text = lineText(modelLine);
      if (text) {
        lines.push("    - " + text);
      }
    });
  });
}

function renderSimulationText(mapDescriptionModel) {
  const lines = ["Map content"];
  const model = mapDescriptionModel && typeof mapDescriptionModel === "object" ? mapDescriptionModel : {};
  pushSection(lines, "Ways", model.ways);
  pushSection(lines, "Buildings", model.buildings);
  return lines.join("\n") + "\n";
}

module.exports = {
  renderSimulationText: renderSimulationText
};
