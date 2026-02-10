/* global $ */

(function() {
    "use strict";

    var renderer; // singleton
    var modulesPromise;
    var activePreview;
    var renderToken = 0;
    var splitBenchmarkMsPerTriangle;
    var splitProjectionThresholdMs = 450;
    var splitDebugEnabled;
    var PREVIEW_VISUALS = {
      renderer: {
        toneMapping: "LinearToneMapping",
        toneMappingExposure: 1.16
      },
      lights: {
        ambient: {
          color: 0xffffff,
          intensity: 0.28
        },
        hemi: {
          skyColor: 0xffffff,
          groundColor: 0xa8a8a8,
          intensity: 0.42
        },
        key: {
          color: 0xffffff,
          intensity: 1.9,
          positionMultiplier: { x: 2.6, y: 2.8, z: 1.9 }
        },
        rim: {
          color: 0xdcdcdc,
          intensity: 1.0,
          positionMultiplier: { x: -3.0, y: 1.2, z: -2.2 }
        }
      },
      materials: {
        featureColor: 0xf4f4f4,
        baseColor: 0xc4c4c4,
        fallbackColor: 0xd7d7d7,
        roughness: 0.22,
        metalness: 0.05
      }
    };

    function getNowMs() {
      if (typeof performance !== "undefined" && typeof performance.now === "function") {
        return performance.now();
      }
      return Date.now();
    }

    function makeEdgeKey(a, b, multiplier) {
      if (a < b) {
        return a * multiplier + b;
      }
      return b * multiplier + a;
    }

    function appendEdgeTriangle(edgeToTriangles, edgeKey, triangleIndex) {
      var existing = edgeToTriangles.get(edgeKey);
      if (typeof existing === "number") {
        edgeToTriangles.set(edgeKey, [existing, triangleIndex]);
        return;
      }
      if (existing) {
        existing.push(triangleIndex);
        return;
      }
      edgeToTriangles.set(edgeKey, triangleIndex);
    }

    function triangleCountFromGeometry(geometry) {
      var positionAttr = geometry.getAttribute("position");
      if (!positionAttr) {
        return 0;
      }
      var indexAttr = geometry.getIndex();
      if (indexAttr) {
        return Math.floor(indexAttr.count / 3);
      }
      return Math.floor(positionAttr.count / 3);
    }

    function runSplitBenchmark(sampleTriangleCount) {
      var triangleCount = Math.max(1500, sampleTriangleCount || 6000);
      var vertexCount = triangleCount * 3;
      var positions = new Float32Array(vertexCount * 3);
      var i;
      for (i = 0; i < positions.length; i += 3) {
        var vertex = i / 3;
        positions[i] = (vertex % 97) * 0.013;
        positions[i + 1] = (vertex % 89) * 0.017;
        positions[i + 2] = (vertex % 53) * 0.011;
      }

      var quantScale = 10000;
      var edgeMultiplier = vertexCount + 1;

      function runPass() {
        var vertexBuckets = new Map();
        var edgeToTriangles = new Map();
        var nextVertexId = 0;
        var t0 = getNowMs();

        function getVertexIdFromCoords(x, y, z) {
          var qx = Math.round(x * quantScale);
          var qy = Math.round(y * quantScale);
          var qz = Math.round(z * quantScale);
          var hash = ((qx * 73856093) ^ (qy * 19349663) ^ (qz * 83492791)) >>> 0;
          var bucket = vertexBuckets.get(hash);
          var idx;

          if (!bucket) {
            bucket = [];
            vertexBuckets.set(hash, bucket);
          } else {
            for (idx = 0; idx < bucket.length; idx += 4) {
              if (bucket[idx] === qx && bucket[idx + 1] === qy && bucket[idx + 2] === qz) {
                return bucket[idx + 3];
              }
            }
          }

          var newId = nextVertexId;
          nextVertexId += 1;
          bucket.push(qx, qy, qz, newId);
          return newId;
        }

        var tri;
        for (tri = 0; tri < triangleCount; tri += 1) {
          var base = tri * 9;
          var x1 = positions[base];
          var y1 = positions[base + 1];
          var z1 = positions[base + 2];
          var x2 = positions[base + 3];
          var y2 = positions[base + 4];
          var z2 = positions[base + 5];
          var x3 = positions[base + 6];
          var y3 = positions[base + 7];
          var z3 = positions[base + 8];

          var ux = x2 - x1;
          var uy = y2 - y1;
          var uz = z2 - z1;
          var vx = x3 - x1;
          var vy = y3 - y1;
          var vz = z3 - z1;
          var cx = (uy * vz) - (uz * vy);
          var cy = (uz * vx) - (ux * vz);
          var cz = (ux * vy) - (uy * vx);
          var norm = Math.sqrt((cx * cx) + (cy * cy) + (cz * cz));
          if (!isFinite(norm)) {
            return Infinity;
          }

          var v1 = getVertexIdFromCoords(x1, y1, z1);
          var v2 = getVertexIdFromCoords(x2, y2, z2);
          var v3 = getVertexIdFromCoords(x3, y3, z3);

          appendEdgeTriangle(edgeToTriangles, makeEdgeKey(v1, v2, edgeMultiplier), tri);
          appendEdgeTriangle(edgeToTriangles, makeEdgeKey(v2, v3, edgeMultiplier), tri);
          appendEdgeTriangle(edgeToTriangles, makeEdgeKey(v3, v1, edgeMultiplier), tri);
        }

        var edgeRefCount = 0;
        edgeToTriangles.forEach(function(value) {
          if (typeof value === "number") {
            edgeRefCount += 1;
          } else {
            edgeRefCount += value.length;
          }
        });

        var elapsed = getNowMs() - t0;
        return edgeRefCount > 0 ? elapsed / triangleCount : Infinity;
      }

      runPass(); // warm-up
      return runPass();
    }

    function isSplitDebugEnabled() {
      if (typeof splitDebugEnabled === "boolean") {
        return splitDebugEnabled;
      }

      if (!window || !window.location || typeof window.location.search !== "string") {
        splitDebugEnabled = false;
        return splitDebugEnabled;
      }

      if (typeof URLSearchParams === "function") {
        var params = new URLSearchParams(window.location.search);
        splitDebugEnabled = params.get("splitdebug") === "1";
        return splitDebugEnabled;
      }

      splitDebugEnabled = /(?:\?|&)splitdebug=1(?:&|$)/.test(window.location.search);
      return splitDebugEnabled;
    }

    function splitDebugLog(message) {
      if (!isSplitDebugEnabled()) {
        return;
      }
      if (window.console && typeof window.console.info === "function") {
        window.console.info("[3d-preview]", message);
      }
    }

    function shouldEnableBaseSplit(triangleCount) {
      if (triangleCount < 4) {
        splitDebugLog("base split skipped: too few triangles (" + triangleCount + ")");
        return false;
      }

      if (typeof splitBenchmarkMsPerTriangle !== "number" || !isFinite(splitBenchmarkMsPerTriangle)) {
        splitBenchmarkMsPerTriangle = runSplitBenchmark(Math.min(Math.max(triangleCount, 3000), 9000));
        splitDebugLog(
          "base split benchmark computed: " + splitBenchmarkMsPerTriangle.toFixed(4) + " ms/triangle"
        );
      }

      if (!isFinite(splitBenchmarkMsPerTriangle) || splitBenchmarkMsPerTriangle <= 0) {
        splitDebugLog("base split skipped: benchmark invalid");
        return false;
      }

      var projectedMs = splitBenchmarkMsPerTriangle * triangleCount;
      var enabled = projectedMs < splitProjectionThresholdMs;
      splitDebugLog(
        "base split projection " + projectedMs.toFixed(1) + " ms for " + triangleCount +
        " triangles (threshold " + splitProjectionThresholdMs + "): " + (enabled ? "enabled" : "disabled")
      );
      return enabled;
    }

    function splitPositionsToGeometry(THREE, positions) {
      if (!positions || !positions.length) {
        return null;
      }
      var geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.computeVertexNormals();
      return geometry;
    }

    function buildSplitGeometries(THREE, sourcePositions, triangleSourceVertexIndices, isBaseTriangle, baseTriangleCount) {
      var triangleCount = isBaseTriangle.length;
      var featureTriangleCount = triangleCount - baseTriangleCount;

      if (baseTriangleCount < 1 || featureTriangleCount < 1) {
        return null;
      }

      var basePositions = new Float32Array(baseTriangleCount * 9);
      var featurePositions = new Float32Array(featureTriangleCount * 9);
      var baseWrite = 0;
      var featureWrite = 0;
      var tri;

      for (tri = 0; tri < triangleCount; tri += 1) {
        var srcOffset = tri * 3;
        var vertexA = triangleSourceVertexIndices[srcOffset] * 3;
        var vertexB = triangleSourceVertexIndices[srcOffset + 1] * 3;
        var vertexC = triangleSourceVertexIndices[srcOffset + 2] * 3;

        if (isBaseTriangle[tri]) {
          basePositions[baseWrite] = sourcePositions[vertexA];
          basePositions[baseWrite + 1] = sourcePositions[vertexA + 1];
          basePositions[baseWrite + 2] = sourcePositions[vertexA + 2];
          basePositions[baseWrite + 3] = sourcePositions[vertexB];
          basePositions[baseWrite + 4] = sourcePositions[vertexB + 1];
          basePositions[baseWrite + 5] = sourcePositions[vertexB + 2];
          basePositions[baseWrite + 6] = sourcePositions[vertexC];
          basePositions[baseWrite + 7] = sourcePositions[vertexC + 1];
          basePositions[baseWrite + 8] = sourcePositions[vertexC + 2];
          baseWrite += 9;
        } else {
          featurePositions[featureWrite] = sourcePositions[vertexA];
          featurePositions[featureWrite + 1] = sourcePositions[vertexA + 1];
          featurePositions[featureWrite + 2] = sourcePositions[vertexA + 2];
          featurePositions[featureWrite + 3] = sourcePositions[vertexB];
          featurePositions[featureWrite + 4] = sourcePositions[vertexB + 1];
          featurePositions[featureWrite + 5] = sourcePositions[vertexB + 2];
          featurePositions[featureWrite + 6] = sourcePositions[vertexC];
          featurePositions[featureWrite + 7] = sourcePositions[vertexC + 1];
          featurePositions[featureWrite + 8] = sourcePositions[vertexC + 2];
          featureWrite += 9;
        }
      }

      return {
        baseGeometry: splitPositionsToGeometry(THREE, basePositions),
        featureGeometry: splitPositionsToGeometry(THREE, featurePositions)
      };
    }

    function trySplitBaseGeometry(THREE, geometry) {
      var positionAttr = geometry.getAttribute("position");
      if (!positionAttr || positionAttr.itemSize !== 3) {
        return null;
      }

      var triangleCount = triangleCountFromGeometry(geometry);
      if (!shouldEnableBaseSplit(triangleCount)) {
        return null;
      }

      var sourcePositions = positionAttr.array;
      var sourceIndex = geometry.getIndex();
      var sourceIndices = sourceIndex ? sourceIndex.array : null;
      var sourceVertexCount = positionAttr.count;
      var quantIdBySourceVertex = new Int32Array(sourceVertexCount);
      var quantScale = 10000;
      var edgeMultiplier = sourceVertexCount + 1;

      var triangleSourceVertexIndices = new Uint32Array(triangleCount * 3);
      var triangleEdgeKeys = new Float64Array(triangleCount * 3);
      var triangleAreas = new Float32Array(triangleCount);
      var triangleNormalZ = new Float32Array(triangleCount);
      var triangleMinZ = new Float32Array(triangleCount);
      var triangleMaxZ = new Float32Array(triangleCount);
      var edgeToTriangles = new Map();
      var quantVertexBuckets = new Map();
      var maxArea = 0;
      var nextQuantVertexId = 0;
      var tri;

      function getQuantizedVertexId(sourceVertexIndex) {
        var cached = quantIdBySourceVertex[sourceVertexIndex];
        if (cached > 0) {
          return cached - 1;
        }

        var src = sourceVertexIndex * 3;
        var qx = Math.round(sourcePositions[src] * quantScale);
        var qy = Math.round(sourcePositions[src + 1] * quantScale);
        var qz = Math.round(sourcePositions[src + 2] * quantScale);
        var hash = ((qx * 73856093) ^ (qy * 19349663) ^ (qz * 83492791)) >>> 0;
        var bucket = quantVertexBuckets.get(hash);
        var idx;

        if (!bucket) {
          bucket = [];
          quantVertexBuckets.set(hash, bucket);
        } else {
          for (idx = 0; idx < bucket.length; idx += 4) {
            if (bucket[idx] === qx && bucket[idx + 1] === qy && bucket[idx + 2] === qz) {
              quantIdBySourceVertex[sourceVertexIndex] = bucket[idx + 3] + 1;
              return bucket[idx + 3];
            }
          }
        }

        var newId = nextQuantVertexId;
        nextQuantVertexId += 1;
        bucket.push(qx, qy, qz, newId);
        quantIdBySourceVertex[sourceVertexIndex] = newId + 1;
        return newId;
      }

      for (tri = 0; tri < triangleCount; tri += 1) {
        var srcOffset = tri * 3;
        var ia = sourceIndices ? sourceIndices[srcOffset] : srcOffset;
        var ib = sourceIndices ? sourceIndices[srcOffset + 1] : (srcOffset + 1);
        var ic = sourceIndices ? sourceIndices[srcOffset + 2] : (srcOffset + 2);
        triangleSourceVertexIndices[srcOffset] = ia;
        triangleSourceVertexIndices[srcOffset + 1] = ib;
        triangleSourceVertexIndices[srcOffset + 2] = ic;

        var a = ia * 3;
        var b = ib * 3;
        var c = ic * 3;
        var ax = sourcePositions[a];
        var ay = sourcePositions[a + 1];
        var az = sourcePositions[a + 2];
        var bx = sourcePositions[b];
        var by = sourcePositions[b + 1];
        var bz = sourcePositions[b + 2];
        var cx = sourcePositions[c];
        var cy = sourcePositions[c + 1];
        var cz = sourcePositions[c + 2];

        var ux = bx - ax;
        var uy = by - ay;
        var uz = bz - az;
        var vx = cx - ax;
        var vy = cy - ay;
        var vz = cz - az;
        var crossX = (uy * vz) - (uz * vy);
        var crossY = (uz * vx) - (ux * vz);
        var crossZ = (ux * vy) - (uy * vx);
        var crossLen = Math.sqrt((crossX * crossX) + (crossY * crossY) + (crossZ * crossZ));
        var triArea = crossLen * 0.5;
        triangleAreas[tri] = triArea;
        if (triArea > maxArea) {
          maxArea = triArea;
        }
        triangleNormalZ[tri] = crossLen > 1e-9 ? (crossZ / crossLen) : 0;

        var minZ = az;
        var maxZ = az;
        if (bz < minZ) {
          minZ = bz;
        } else if (bz > maxZ) {
          maxZ = bz;
        }
        if (cz < minZ) {
          minZ = cz;
        } else if (cz > maxZ) {
          maxZ = cz;
        }
        triangleMinZ[tri] = minZ;
        triangleMaxZ[tri] = maxZ;

        var qa = getQuantizedVertexId(ia);
        var qb = getQuantizedVertexId(ib);
        var qc = getQuantizedVertexId(ic);
        var edgeA = makeEdgeKey(qa, qb, edgeMultiplier);
        var edgeB = makeEdgeKey(qb, qc, edgeMultiplier);
        var edgeC = makeEdgeKey(qc, qa, edgeMultiplier);
        triangleEdgeKeys[srcOffset] = edgeA;
        triangleEdgeKeys[srcOffset + 1] = edgeB;
        triangleEdgeKeys[srcOffset + 2] = edgeC;
        appendEdgeTriangle(edgeToTriangles, edgeA, tri);
        appendEdgeTriangle(edgeToTriangles, edgeB, tri);
        appendEdgeTriangle(edgeToTriangles, edgeC, tri);
      }

      if (!(maxArea > 0)) {
        return null;
      }

      var areaThreshold = maxArea * 0.95;
      var isBaseTriangle = new Uint8Array(triangleCount);
      var queue = new Int32Array(triangleCount);
      var queueHead = 0;
      var queueTail = 0;
      var baseTriangleCount = 0;

      for (tri = 0; tri < triangleCount; tri += 1) {
        var zSpan = triangleMaxZ[tri] - triangleMinZ[tri];
        if (
          triangleAreas[tri] >= areaThreshold &&
          Math.abs(triangleNormalZ[tri]) >= 0.98 &&
          zSpan <= 0.01
        ) {
          isBaseTriangle[tri] = 1;
          queue[queueTail] = tri;
          queueTail += 1;
          baseTriangleCount += 1;
        }
      }

      if (baseTriangleCount < 2) {
        splitDebugLog("base split skipped: no seed component (seed count " + baseTriangleCount + ")");
        return null;
      }

      while (queueHead < queueTail) {
        var current = queue[queueHead];
        queueHead += 1;
        var currentOffset = current * 3;
        var edgeIdx;

        for (edgeIdx = 0; edgeIdx < 3; edgeIdx += 1) {
          var neighbors = edgeToTriangles.get(triangleEdgeKeys[currentOffset + edgeIdx]);
          if (typeof neighbors === "number") {
            if (!isBaseTriangle[neighbors]) {
              isBaseTriangle[neighbors] = 1;
              queue[queueTail] = neighbors;
              queueTail += 1;
              baseTriangleCount += 1;
            }
            continue;
          }

          if (!neighbors) {
            continue;
          }

          var n;
          for (n = 0; n < neighbors.length; n += 1) {
            var next = neighbors[n];
            if (!isBaseTriangle[next]) {
              isBaseTriangle[next] = 1;
              queue[queueTail] = next;
              queueTail += 1;
              baseTriangleCount += 1;
            }
          }
        }
      }

      if (
        baseTriangleCount < 4 ||
        baseTriangleCount >= triangleCount ||
        baseTriangleCount > (triangleCount * 0.35)
      ) {
        splitDebugLog(
          "base split skipped: invalid base size " + baseTriangleCount + " / " + triangleCount
        );
        return null;
      }

      splitDebugLog(
        "base split detected: base triangles " + baseTriangleCount + ", features " +
        (triangleCount - baseTriangleCount)
      );

      return buildSplitGeometries(
        THREE,
        sourcePositions,
        triangleSourceVertexIndices,
        isBaseTriangle,
        baseTriangleCount
      );
    }

    function cleanupActivePreview() {
      if (!activePreview) {
        return;
      }
      if (activePreview.resizeObserver) {
        activePreview.resizeObserver.disconnect();
      }
      if (activePreview.onWindowResize) {
        window.removeEventListener("resize", activePreview.onWindowResize);
      }
      if (activePreview.controls) {
        activePreview.controls.dispose();
      }
      if (activePreview.disposeScene) {
        activePreview.disposeScene();
      }
      if (renderer) {
        renderer.setAnimationLoop(null);
      }
      activePreview = null;
    }

    function loadThreeModules() {
      if (modulesPromise) {
        return modulesPromise;
      }
      if (typeof window.tmImportModule !== "function") {
        return Promise.reject(new Error("tmImportModule is not available"));
      }
      modulesPromise = Promise.all([
        window.tmImportModule("three"),
        window.tmImportModule("three/addons/loaders/STLLoader.js"),
        window.tmImportModule("three/addons/controls/OrbitControls.js")
      ]).then(function(modules) {
        return {
          THREE: modules[0],
          STLLoader: modules[1].STLLoader,
          OrbitControls: modules[2].OrbitControls
        };
      }).catch(function(error) {
        modulesPromise = null;
        throw error;
      });
      return modulesPromise;
    }

    function readSize(elem, fallbackWidth, fallbackHeight) {
      return {
        width: Math.max(1, Math.round(elem.width() || fallbackWidth)),
        height: Math.max(1, Math.round(elem.height() || fallbackHeight))
      };
    }

    function makePreviewMaterial(THREE, color) {
      return new THREE.MeshStandardMaterial({
        color: color,
        roughness: PREVIEW_VISUALS.materials.roughness,
        metalness: PREVIEW_VISUALS.materials.metalness,
        side: THREE.DoubleSide
      });
    }

    function showError(elem, msg) {
      $(".preview-3d-container").css("opacity", 1);
      elem.empty().append("<p class='loading-3d-preview'>" + msg + "</p>");
    }

    window.show3dPreview = function(targetElem, s3url) {
      var elem = targetElem || $("body");
      var size = readSize(elem, 680, 500);
      var token = renderToken + 1;
      renderToken = token;

      cleanupActivePreview();
      $(".preview-3d-container").css("opacity", 1);
      elem.empty().append("<p class='loading-3d-preview'>Loading 3D preview...</p>");

      loadThreeModules().then(function(moduleSet) {
        if (token !== renderToken) {
          return;
        }

        var THREE = moduleSet.THREE;
        var STLLoader = moduleSet.STLLoader;
        var OrbitControls = moduleSet.OrbitControls;

        if (!renderer) {
          renderer = new THREE.WebGLRenderer({ antialias: true });
        }
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(size.width, size.height, false);
        renderer.setClearColor(0x000000, 0);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE[PREVIEW_VISUALS.renderer.toneMapping] || THREE.NoToneMapping;
        renderer.toneMappingExposure = PREVIEW_VISUALS.renderer.toneMappingExposure;
        renderer.shadowMap.enabled = false;

        var scene = new THREE.Scene();
        scene.background = null;

        var camera = new THREE.PerspectiveCamera(34, size.width / size.height, 0.1, 1000);

        var ambientLight = new THREE.AmbientLight(
          PREVIEW_VISUALS.lights.ambient.color,
          PREVIEW_VISUALS.lights.ambient.intensity
        );
        var hemiLight = new THREE.HemisphereLight(
          PREVIEW_VISUALS.lights.hemi.skyColor,
          PREVIEW_VISUALS.lights.hemi.groundColor,
          PREVIEW_VISUALS.lights.hemi.intensity
        );
        var keyLight = new THREE.DirectionalLight(
          PREVIEW_VISUALS.lights.key.color,
          PREVIEW_VISUALS.lights.key.intensity
        );
        var rimLight = new THREE.DirectionalLight(
          PREVIEW_VISUALS.lights.rim.color,
          PREVIEW_VISUALS.lights.rim.intensity
        );
        scene.add(ambientLight);
        scene.add(hemiLight);
        scene.add(keyLight);
        scene.add(rimLight);

        var loader = new STLLoader();
        loader.load(s3url, function(geometry) {
          if (token !== renderToken) {
            geometry.dispose();
            return;
          }

          geometry.computeVertexNormals();
          geometry.computeBoundingBox();
          geometry.computeBoundingSphere();

          if (!geometry.boundingBox) {
            showError(elem, "Could not render 3D preview.");
            return;
          }

          var center = new THREE.Vector3();
          geometry.boundingBox.getCenter(center);
          geometry.translate(-center.x, -center.y, -center.z);
          geometry.computeBoundingBox();
          geometry.computeBoundingSphere();

          var radius = geometry.boundingSphere ? geometry.boundingSphere.radius : 1;
          if (!isFinite(radius) || radius <= 0) {
            radius = 1;
          }

          var modelGroup = new THREE.Group();
          modelGroup.rotation.x = -Math.PI / 4; // keep map tilt from the legacy preview
          scene.add(modelGroup);

          var managedGeometries = [];
          var managedMaterials = [];
          var splitResult = null;

          try {
            splitResult = trySplitBaseGeometry(THREE, geometry);
          } catch (splitError) {
            if (window.console && window.console.warn) {
              window.console.warn("3D preview base split failed, rendering with a single material.", splitError);
            }
          }

          if (splitResult && splitResult.baseGeometry && splitResult.featureGeometry) {
            var featureMaterial = makePreviewMaterial(THREE, PREVIEW_VISUALS.materials.featureColor);
            var baseMaterial = makePreviewMaterial(THREE, PREVIEW_VISUALS.materials.baseColor);
            var baseMesh = new THREE.Mesh(splitResult.baseGeometry, baseMaterial);
            var featureMesh = new THREE.Mesh(splitResult.featureGeometry, featureMaterial);

            modelGroup.add(baseMesh);
            modelGroup.add(featureMesh);
            splitDebugLog("base split render path active");

            managedGeometries.push(splitResult.baseGeometry, splitResult.featureGeometry);
            managedMaterials.push(baseMaterial, featureMaterial);
            geometry.dispose();
          } else {
            splitDebugLog("single material fallback render path active");
            var material = makePreviewMaterial(THREE, PREVIEW_VISUALS.materials.fallbackColor);
            var mesh = new THREE.Mesh(geometry, material);
            modelGroup.add(mesh);
            managedGeometries.push(geometry);
            managedMaterials.push(material);
          }

          var distance = radius * 2.45;
          camera.near = Math.max(distance / 120, 0.1);
          camera.far = Math.max(distance * 25, 10);
          camera.position.set(distance * 0.95, -distance * 0.28, distance * 0.9);
          camera.lookAt(0, 0, 0);
          camera.updateProjectionMatrix();

          keyLight.position.set(
            radius * PREVIEW_VISUALS.lights.key.positionMultiplier.x,
            radius * PREVIEW_VISUALS.lights.key.positionMultiplier.y,
            radius * PREVIEW_VISUALS.lights.key.positionMultiplier.z
          );
          rimLight.position.set(
            radius * PREVIEW_VISUALS.lights.rim.positionMultiplier.x,
            radius * PREVIEW_VISUALS.lights.rim.positionMultiplier.y,
            radius * PREVIEW_VISUALS.lights.rim.positionMultiplier.z
          );

          var controls = new OrbitControls(camera, renderer.domElement);
          controls.enableDamping = true;
          controls.dampingFactor = 0.08;
          controls.autoRotate = true;
          controls.autoRotateSpeed = 0.35;
          controls.minDistance = radius * 0.9;
          controls.maxDistance = radius * 8;
          controls.minPolarAngle = Math.PI * 0.12;
          controls.maxPolarAngle = Math.PI * 0.58;
          controls.target.set(0, 0, 0);
          controls.update();

          function controlsStateSnapshot(orbitControls) {
            return {
              azimuth: orbitControls.getAzimuthalAngle(),
              polar: orbitControls.getPolarAngle(),
              targetX: orbitControls.target.x,
              targetY: orbitControls.target.y,
              targetZ: orbitControls.target.z
            };
          }

          function hasRotateOrDragFromSnapshot(startState, currentState) {
            if (!startState || !currentState) {
              return false;
            }
            var angleEpsilon = 0.0001;
            var targetEpsilon = 0.0001;
            var azimuthDiff = Math.abs(currentState.azimuth - startState.azimuth);
            var polarDiff = Math.abs(currentState.polar - startState.polar);
            var targetMoved = Math.abs(currentState.targetX - startState.targetX) > targetEpsilon ||
              Math.abs(currentState.targetY - startState.targetY) > targetEpsilon ||
              Math.abs(currentState.targetZ - startState.targetZ) > targetEpsilon;
            return azimuthDiff > angleEpsilon || polarDiff > angleEpsilon || targetMoved;
          }

          var autoRotateStoppedByUser = false;
          var interactionStartState = null;
          controls.addEventListener("start", function() {
            interactionStartState = controlsStateSnapshot(controls);
          });
          controls.addEventListener("change", function() {
            if (autoRotateStoppedByUser || !interactionStartState) {
              return;
            }
            if (hasRotateOrDragFromSnapshot(interactionStartState, controlsStateSnapshot(controls))) {
              controls.autoRotate = false;
              autoRotateStoppedByUser = true;
              interactionStartState = null;
            }
          });
          controls.addEventListener("end", function() {
            interactionStartState = null;
          });

          elem.empty().append(renderer.domElement);

          function updateSize() {
            var currentSize = readSize(elem, size.width, size.height);
            camera.aspect = currentSize.width / currentSize.height;
            camera.updateProjectionMatrix();
            renderer.setSize(currentSize.width, currentSize.height, false);
          }

          var onWindowResize = function() {
            if (token === renderToken) {
              updateSize();
            }
          };
          window.addEventListener("resize", onWindowResize);

          var resizeObserver = null;
          if (window.ResizeObserver && elem[0]) {
            resizeObserver = new window.ResizeObserver(function() {
              if (token === renderToken) {
                updateSize();
              }
            });
            resizeObserver.observe(elem[0]);
          }

          activePreview = {
            controls: controls,
            resizeObserver: resizeObserver,
            onWindowResize: onWindowResize,
            disposeScene: function() {
              managedGeometries.forEach(function(item) {
                item.dispose();
              });
              managedMaterials.forEach(function(item) {
                item.dispose();
              });
            }
          };

          renderer.setAnimationLoop(function() {
            if (token !== renderToken) {
              return;
            }
            controls.update();
            renderer.render(scene, camera);
          });

          $(".preview-3d-container").css("opacity", 1);
        }, undefined, function() {
          if (token === renderToken) {
            showError(elem, "Could not load 3D preview.");
          }
        });
      }).catch(function(error) {
        console.error(error);
        if (token === renderToken) {
          showError(elem, "Could not load 3D preview modules.");
        }
      });
    };
})();
