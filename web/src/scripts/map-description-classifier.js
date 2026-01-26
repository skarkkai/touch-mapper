/* global window */
/*
Usage (CLI):
  node web/src/scripts/map-description-classifier.js /path/to/map-meta.json

If no path is provided, it tries:
  1) ./map-data.json (for legacy naming)
  2) ./test/data/map-meta.indented.json

Output:
  Prints grouped JSON to stdout.
*/
/* eslint no-console:0 */

(function(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.TM = root.TM || {};
    root.TM.mapDescriptionClassifier = factory();
  }
})(typeof self !== "undefined" ? self : this, function() {
  "use strict";

  function getField(item, path) {
    if (!path) return undefined;
    var parts = path.split(".");
    var cur = item;
    for (var i = 0; i < parts.length; i += 1) {
      if (!cur) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  function matchTagsAny(tags, conditions) {
    if (!conditions || !conditions.length) return true;
    for (var i = 0; i < conditions.length; i += 1) {
      var cond = conditions[i];
      var key = cond.key;
      if (!tags || !(key in tags)) continue;
      var val = tags[key];
      if (cond.anyValue) {
        if (val !== null && val !== undefined && val !== "") return true;
        continue;
      }
      var values = cond.values || [];
      if (values.indexOf(val) !== -1) return true;
    }
    return false;
  }

  function matchTagsAll(tags, conditions) {
    if (!conditions || !conditions.length) return true;
    for (var i = 0; i < conditions.length; i += 1) {
      var cond = conditions[i];
      var key = cond.key;
      if (!tags || !(key in tags)) return false;
      var val = tags[key];
      if (cond.anyValue) {
        if (val === null || val === undefined || val === "") return false;
        continue;
      }
      var values = cond.values || [];
      if (values.indexOf(val) === -1) return false;
    }
    return true;
  }

  function matchAnyField(item, fieldName, values) {
    if (!values || !values.length) return false;
    var val = item[fieldName];
    if (!val) return false;
    if (Array.isArray(val)) {
      for (var i = 0; i < val.length; i += 1) {
        if (values.indexOf(val[i]) !== -1) return true;
      }
      return false;
    }
    return values.indexOf(val) !== -1;
  }

  function matchRule(item, rule, inputs) {
    if (rule.elementTypes) {
      if (rule.elementTypes.indexOf(item[inputs.elementTypeField]) === -1) return false;
    }
    if (rule.geometryTypes) {
      var geomType = getField(item, inputs.geometryTypeField);
      if (rule.geometryTypes.indexOf(geomType) === -1) return false;
    }
    if (rule.primaryRepresentationAny) {
      if (!matchAnyField(item, inputs.primaryRepresentationField, rule.primaryRepresentationAny)) return false;
    }
    if (rule.representationsAny) {
      if (!matchAnyField(item, inputs.representationsField, rule.representationsAny)) return false;
    }
    if (rule.tmCategoryAny) {
      if (!matchAnyField(item, inputs.tmCategoryField, rule.tmCategoryAny)) return false;
    }
    if (rule.tmRoadTypeAny) {
      if (!matchAnyField(item, inputs.tmRoadTypeField, rule.tmRoadTypeAny)) return false;
    }

    var tags = item[inputs.tagsField] || {};
    if (rule.tagsAny && !matchTagsAny(tags, rule.tagsAny)) return false;
    if (rule.tagsAll && !matchTagsAll(tags, rule.tagsAll)) return false;

    if (rule.anyOf) {
      var anyMatched = false;
      for (var i = 0; i < rule.anyOf.length; i += 1) {
        if (matchRule(item, rule.anyOf[i], inputs)) {
          anyMatched = true;
          break;
        }
      }
      if (!anyMatched) return false;
    }
    if (rule.allOf) {
      for (var j = 0; j < rule.allOf.length; j += 1) {
        if (!matchRule(item, rule.allOf[j], inputs)) return false;
      }
    }

    return true;
  }

  function collectModifiers(item, spec, options) {
    var inputs = spec.inputs;
    var modifiers = [];
    var rules = spec.modifierRules || [];
    for (var i = 0; i < rules.length; i += 1) {
      var rule = rules[i];
      if (!matchRule(item, rule, inputs)) continue;
      var mods = rule.modifiers || [];
      for (var m = 0; m < mods.length; m += 1) {
        var mod = mods[m];
        var entry = { name: mod.name };
        if (mod.valueFromTag) {
          var tags = item[inputs.tagsField] || {};
          entry.value = tags[mod.valueFromTag];
        }
        modifiers.push(entry);
      }
    }
    return modifiers;
  }

  function classifyItem(item, spec, optionsOverride) {
    var inputs = spec.inputs;
    var options = Object.assign({}, spec.options || {}, optionsOverride || {});
    var rules = spec.rules || [];
    for (var i = 0; i < rules.length; i += 1) {
      var rule = rules[i];
      if (!matchRule(item, rule, inputs)) continue;
      var actions = rule.actions || {};
      var ignore = !!actions.ignore;
      var optName = actions.ignoreWhenOptionFalse;
      if (optName && !options[optName]) ignore = true;
      return {
        mainClass: rule.mainClass,
        subClass: rule.subClass,
        ruleId: rule.id,
        ignore: ignore,
        role: actions.role,
        poiImportance: actions.poiImportance
      };
    }
    var fallbacks = spec.fallbacks || [];
    for (var j = 0; j < fallbacks.length; j += 1) {
      var fb = fallbacks[j];
      if (!matchRule(item, fb, inputs)) continue;
      return {
        mainClass: fb.mainClass,
        subClass: fb.subClass,
        ruleId: fb.id,
        ignore: false
      };
    }
    return null;
  }

  function groupMapData(mapData, spec, optionsOverride) {
    var grouped = {};
    Object.keys(spec.classes || {}).forEach(function(mainKey) {
      grouped[mainKey] = {};
    });

    function addItem(item) {
      var classification = classifyItem(item, spec, optionsOverride);
      if (!classification) return;
      if (classification.ignore) return;
      var modifiers = collectModifiers(item, spec, optionsOverride);
      var entry = Object.assign({}, item);
      entry._classification = {
        mainClass: classification.mainClass,
        subClass: classification.subClass,
        ruleId: classification.ruleId,
        role: classification.role,
        poiImportance: classification.poiImportance,
        modifiers: modifiers
      };
      var mainGroup = grouped[classification.mainClass];
      if (!mainGroup) {
        grouped[classification.mainClass] = {};
        mainGroup = grouped[classification.mainClass];
      }
      if (!mainGroup[classification.subClass]) {
        mainGroup[classification.subClass] = [];
      }
      mainGroup[classification.subClass].push(entry);
    }

    Object.keys(mapData || {}).forEach(function(key) {
      var value = mapData[key];
      if (!Array.isArray(value)) return;
      for (var i = 0; i < value.length; i += 1) {
        var item = value[i];
        if (item && typeof item === "object" && item.elementType) {
          addItem(item);
        }
      }
    });

    return grouped;
  }

  function runStandalone(args) {
    var fs = require("fs");
    var path = require("path");
    var specPath = path.join(__dirname, "map-description-classifications.json");
    var spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
    var inputPath = args[0] || path.join(process.cwd(), "map-meta.json");
    if (!fs.existsSync(inputPath)) {
      inputPath = path.join(process.cwd(), "test/data/map-meta.indented.json");
    }
    var mapData = JSON.parse(fs.readFileSync(inputPath, "utf8"));
    var grouped = groupMapData(mapData, spec, null);
    console.log(JSON.stringify(grouped, null, 2));
    return grouped;
  }

  return {
    classifyItem: classifyItem,
    groupMapData: groupMapData,
    runStandalone: runStandalone
  };
});

if (typeof module === "object" && module.exports && require.main === module) {
  var args = process.argv.slice(2);
  module.exports.runStandalone(args);
}
