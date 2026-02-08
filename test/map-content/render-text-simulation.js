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
  const itemPrefix = label === "Buildings"
    ? "Building"
    : (label.indexOf("POI") === 0 ? "POI" : "Feature");

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
  pushSection(lines, "Roads", model.roads || model.ways);
  if (model.paths && Number(model.paths.count) > 0) {
    pushSection(lines, "Paths", model.paths);
  }
  if (model.railways && Number(model.railways.count) > 0) {
    pushSection(lines, "Railways", model.railways);
  }
  if (model.waterways && Number(model.waterways.count) > 0) {
    pushSection(lines, "Waterways", model.waterways);
  }
  if (model.otherLinear && Number(model.otherLinear.count) > 0) {
    pushSection(lines, "Other linear features", model.otherLinear);
  }
  pushSection(lines, "Buildings", model.buildings);
  if (model.poiFamiliar) {
    pushSection(lines, "POI familiar places", model.poiFamiliar);
  }
  if (model.poiDaily && Number(model.poiDaily.count) > 0) {
    pushSection(lines, "POI daily essentials", model.poiDaily);
  }
  if (model.poiTransport && Number(model.poiTransport.count) > 0) {
    pushSection(lines, "POI transport points", model.poiTransport);
  }
  return lines.join("\n") + "\n";
}

module.exports = {
  renderSimulationText: renderSimulationText
};
