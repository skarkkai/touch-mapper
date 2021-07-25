'use strict';
/* eslint camelcase:0, quotes:0, space-unary-ops:0, no-alert:0, no-unused-vars:0, no-shadow:0, no-extend-native:0, no-trailing-spaces:0 */

var TS_API_URL = 'https://www.treatstock.com/api/v2';
var TS_KEY_PARAM = 'private-key=95808511e16c642';

function tsUpload(stlUrl, cb) {
    // TODO
    // $ curl -F "files[]=@Kamppi.stl" -F location[ip]=91.152.181.40  https://www.treatstock.com/api/v2/printable-packs?private-key=95808511e16c642
    // {"success":true,"id":1147382,"redir":"https://www.treatstock.com/catalog/model3d/preload-printable-pack?packPublicToken=30c759a-46e3ff8-4b32e07","widgetUrl":"https://www.treatstock.com/api/v2/printable-pack-widget/?apiPrintablePackToken=30c759a-46e3ff8-4b32e07","widgetHtml":"<!-- ApiWidget: 30c759a-46e3ff8-4b32e07 --><link href='https://www.treatstock.com/css/embed-user.css' rel='stylesheet' /><iframe class='ts-embed-userwidget' src='https://www.treatstock.com/api/v2/printable-pack-widget/?apiPrintablePackToken=30c759a-46e3ff8-4b32e07' frameborder='0'></iframe>","parts":{"MP:10668275":{"uid":"MP:10668275","name":"Kamppi.stl","qty":1,"hash":"5a3b63bd75d57e98f8b2a139971b59bd"}}}
    var tsPackId = '1147382';
    cb({
        packId: tsPackId,
        orderUrl: 'https://www.treatstock.com/catalog/model3d/preload-printable-pack?packPublicToken=30c759a-46e3ff8-4b32e07', // valid for 24H
    });
}

function tsGetData(stlUrl, cb) {
    tsUpload(stlUrl, function(uploadResponse) {
        $.ajax({
            type: "GET",
            url: TS_API_URL + '/printable-packs/' + uploadResponse.packId + '?' + TS_KEY_PARAM
        }).fail(function(jqXHR, textStatus, errorThrown){
          if (jqXHR.status !== 200) {
              console.log(textStatus);
              window.alert(textStatus);
          }
        }).done(function(data, textStatus, jqXHR){
            cb({
                packId: uploadResponse.packId,
                orderUrl: uploadResponse.orderUrl,
                price: data.calculated_min_cost.cost,
                currency: data.affiliate_currency });
        });
    });
}


