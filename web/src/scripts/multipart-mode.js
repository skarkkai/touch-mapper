'use strict';
/* global $ mapCalc Backbone isNan _ ol THREE performance google ga fbq TRANSLATIONS i18next show3dPreview */
/* eslint quotes:0, space-unary-ops:0, no-alert:0, no-unused-vars:0, no-shadow:0, no-extend-native:0, no-trailing-spaces:0 */

function initMultipartMode(data, dragPanInteraction) {
    data.on("change:multipartMode", function() {
        $("html").toggleClass("multipart-mode");
        dragPanInteraction.setActive(!data.get("multipartMode"));
        if (!data.get("multipartMode")) {
            setData("multipartXpc", 0);
            setData("multipartYpc", 0);
        }
    });

    data.on("change:multipartXpc change:multipartYpc", function(){
        $(".multipart-adjustment-x").text(data.get("multipartXpc"));
        $(".multipart-adjustment-y").text(data.get("multipartYpc"));
    });

    // Adjust location of multipart map by N% to each direction
    $(".area-movement-buttons .btn.left-10").click(function(){
        setData("multipartXpc", data.get("multipartXpc") - 10);
    });
    $(".area-movement-buttons .btn.left-100").click(function(){
        setData("multipartXpc", data.get("multipartXpc") - 100);
    });
    $(".area-movement-buttons .btn.right-10").click(function(){
        setData("multipartXpc", data.get("multipartXpc") + 10);
    });
    $(".area-movement-buttons .btn.right-100").click(function(){
        setData("multipartXpc", data.get("multipartXpc") + 100);
    });
    $(".area-movement-buttons .btn.up-10").click(function(){
        setData("multipartYpc", data.get("multipartYpc") + 10);
    });
    $(".area-movement-buttons .btn.up-100").click(function(){
        setData("multipartYpc", data.get("multipartYpc") + 100);
    });
    $(".area-movement-buttons .btn.down-10").click(function(){
        setData("multipartYpc", data.get("multipartYpc") - 10);
    });
    $(".area-movement-buttons .btn.down-100").click(function(){
        setData("multipartYpc", data.get("multipartYpc") - 100);
    });

    // Initial values
    setData("multipartXpc", getLocalStorageInt("multipartXpc", 0));
    setData("multipartYpc", getLocalStorageInt("multipartYpc", 0));
    initSimpleInput("multipartMode", $("#multipart-map-input"), "checkbox", false);
}
