/* global $ mapCalc Backbone isNan _ ol THREE performance google ga fbq TRANSLATIONS i18next */
/* eslint quotes:0, space-unary-ops:0, no-alert:0, no-unused-vars:0, no-shadow:0, no-extend-native:0, no-trailing-spaces:0 */

(function(){
    'use strict';

    function lambdaCallback(err, data) {
        if (err) {
            // This doesn't really happen
            if (console) { console.error(err); }
            $('.email-sending-error').slideDown().find('.error-msg-text').text(err);
        } else {
            //if (console) { console.log(data); }
            var errorMsg = 'no Payload';
            try {
                var payload = JSON.parse(data.Payload);
                errorMsg = payload.errorMessage;
            } catch (e) {
                if (console) { console.log(data); }
            }
            if (! data.StatusCode || data.StatusCode !== 200 || data.FunctionError || errorMsg) {
                $('.email-sending-error').slideDown().find('.error-msg-text').text(errorMsg).focus();
            } else {
                var payload = JSON.parse(data.Payload);
                $('.email-sending-success').slideDown().focus();
            }
        }
    }

    function initEmailSending(container, emailType, mapUrl, meta) {
        container.find('.email-sending-form').submit(function(ev){
            ev.preventDefault();

            var email = container.find('#email-addr');
            if (email.val().trim() === '') {
                email.addClass('invalid');
                return;
            }
            email.removeClass('invalid');

            AWS.config.update({
                accessKeyId: 'AKIAIAD65QYHCIFV7BXQ',
                secretAccessKey: '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'
            });
            AWS.config.region = 'eu-west-1';

            var lambda = new AWS.Lambda({apiVersion: '2015-03-31'});
            var payload = {
                mapUrl: mapUrl,
                meta: meta,
                to: email.val(),
                emailType: emailType
            };
            //console.log(JSON.stringify(payload));
            var params = {
              FunctionName: 'SendEmail',
              InvocationType: 'RequestResponse',
              LogType: 'Tail',
              Payload: JSON.stringify(payload)
            };

            $('.email-sending-success').slideUp();
            $('.email-sending-error').slideUp();

            // Disable submit button for a bit
            var submit = container.find('.submit-email');
            submit.attr('disabled', 'disabled');
            setTimeout(function(){
                submit.removeAttr('disabled');
            }, 4000);

            lambda.invoke(params, lambdaCallback);
        });
    }

    window.initEmailSending = initEmailSending;
})();
