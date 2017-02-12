/* global $ mapCalc Backbone isNan _ ol THREE performance google ga fbq TRANSLATIONS i18next */
/* eslint quotes:0, space-unary-ops:0, no-alert:0, no-unused-vars:0, no-shadow:0, no-extend-native:0, no-trailing-spaces:0 */

(function(){
    'use strict';

    var renderer; // singleton

    window.show3dPreview = function(targetElem, s3url) {
      var width = targetElem ? targetElem.width() : 680;
      var height = targetElem ? targetElem.height() : 500;
      var elem = targetElem || $("body");

      elem.append("<p class='loading-3d-preview'>Loading 3D preview...</p>");
      if (! renderer) {
        renderer = new THREE.WebGLRenderer({ antialias: true });
      }
      renderer.setSize(width, height);
      renderer.setClearColor( 0xe8e8e8, 1 );
      // renderer.shadowMap.enabled = true; // doesn't work on an old machine if I enable shadows
      // renderer.shadowMapType = THREE.PCFSoftShadowMap;

      var loader = new THREE.STLLoader();
      var mesh;
      loader.load(s3url, function ( geometry ) {
        // Mesh
        var mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial( { color: 0xffffff } ) );
        mesh.rotation.x = Math.PI * 1.5 + Math.PI / 4;
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        // Lights
        var dirLight = new THREE.DirectionalLight(0xfffbf4, 0.85);
        dirLight.position.set(100, 100, 100);
        // dirLight.castShadow = true;
        // dirLight.shadowMapWidth = 2048; // default is 512
        // dirLight.shadowMapHeight = 2048; // default is 512
        var ambLight = new THREE.AmbientLight(0x404050);

        // Camera
        var camera = new THREE.PerspectiveCamera(25, width / height, 0.1, 0);
        geometry.computeBoundingBox();  // otherwise geometry.boundingBox will be undefined
        var diameter = Math.max(geometry.boundingBox.max.x, geometry.boundingBox.max.y);
        camera.position.z = diameter * 2.375;
        camera.position.y = camera.position.z * -0.04;

        // Center geometry into the origin
        geometry.translate(- diameter / 2, - diameter / 2, 0);

        // Scene
        var scene = new THREE.Scene();
        scene.add(dirLight);
        scene.add(ambLight);
        scene.add(mesh);

        // Replace "Loading..." with renderer
        elem.empty().append(renderer.domElement);

        function getNowMs() {
          return performance ? performance.now() : new Date().getMilliseconds();
        }
        var startTime = getNowMs();
        function render() {
          requestAnimationFrame( render );
          mesh.rotation.z = (getNowMs() - startTime) / -2000;
          renderer.render( scene, camera );
        }
        render();

        setTimeout(function(){
          $(".preview-3d-container").css("opacity", 100);
        }, 1000);
      });
    };
})();
