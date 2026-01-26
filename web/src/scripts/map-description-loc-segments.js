/* global window */
(function(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.TM = root.TM || {};
    root.TM.mapDescriptionLocSegments = factory();
  }
})(typeof self !== "undefined" ? self : this, function() {
  "use strict";

  const CENTER_MIN = 0.375;
  const CENTER_MAX = 0.625;
  const EDGE_THICKNESS = 0.125;
  const OFFSET_MIN = EDGE_THICKNESS;
  const OFFSET_MAX = 1 - EDGE_THICKNESS;

  function clamp(value, min, max) {
    if (value < min) return min;
    if (value > max) return max;
    return value;
  }

  function diagDir(xDir, yDir) {
    if (!xDir && !yDir) return null;
    if (!xDir) return yDir;
    if (!yDir) return xDir;
    return yDir + xDir;
  }

  function diagPhrase(dir) {
    if (!dir) return null;
    if (dir === "northwest") return "north-west";
    if (dir === "northeast") return "north-east";
    if (dir === "southwest") return "south-west";
    if (dir === "southeast") return "south-east";
    return dir;
  }

  function edgePhrase(dir) {
    if (dir === "west") return "near the western edge of the map";
    if (dir === "east") return "near the eastern edge of the map";
    if (dir === "north") return "near the northern edge of the map";
    if (dir === "south") return "near the southern edge of the map";
    return null;
  }

  function cornerPhrase(dir) {
    if (dir === "northwest") return "near the top-left corner of the map";
    if (dir === "northeast") return "near the top-right corner of the map";
    if (dir === "southwest") return "near the bottom-left corner of the map";
    if (dir === "southeast") return "near the bottom-right corner of the map";
    return null;
  }

  function classifyLocation(point, bbox) {
    if (!point || !bbox) return null;
    const width = bbox.maxX - bbox.minX;
    const height = bbox.maxY - bbox.minY;
    if (!isFinite(width) || !isFinite(height) || width === 0 || height === 0) return null;

    let nx = (point.x - bbox.minX) / width;
    let ny = (point.y - bbox.minY) / height;
    nx = clamp(nx, 0, 1);
    ny = clamp(ny, 0, 1);

    const inCenter = nx >= CENTER_MIN && nx <= CENTER_MAX && ny >= CENTER_MIN && ny <= CENTER_MAX;
    if (inCenter) {
      return { zone: "center", dir: null, phrase: "near the center of the map" };
    }

    const edgeX = nx < EDGE_THICKNESS ? "west" : (nx > 1 - EDGE_THICKNESS ? "east" : null);
    const edgeY = ny < EDGE_THICKNESS ? "south" : (ny > 1 - EDGE_THICKNESS ? "north" : null);
    if (edgeX && edgeY) {
      const dir = diagDir(edgeX, edgeY);
      return { zone: "corner", dir: dir, phrase: cornerPhrase(dir) };
    }
    if (edgeX || edgeY) {
      const dir = edgeX || edgeY;
      return { zone: "edge", dir: dir, phrase: edgePhrase(dir) };
    }

    const offsetX = (nx >= OFFSET_MIN && nx <= CENTER_MIN) ? "west" :
      (nx >= CENTER_MAX && nx <= OFFSET_MAX) ? "east" : null;
    const offsetY = (ny >= OFFSET_MIN && ny <= CENTER_MIN) ? "south" :
      (ny >= CENTER_MAX && ny <= OFFSET_MAX) ? "north" : null;
    if (offsetX || offsetY) {
      const dir = diagDir(offsetX, offsetY);
      const phraseDir = diagPhrase(dir);
      return {
        zone: "offset_of_center",
        dir: dir,
        phrase: "a little " + phraseDir + " of the center of the map"
      };
    }

    const partX = nx < 0.5 ? "west" : "east";
    const partY = ny < 0.5 ? "south" : "north";
    const partDir = diagDir(partX, partY);
    const partPhrase = diagPhrase(partDir);
    return {
      zone: "part",
      dir: partDir,
      phrase: "in the " + partPhrase + " part of the map"
    };
  }

  return {
    classifyLocation: classifyLocation
  };
});
