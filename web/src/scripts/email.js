/* global $ mapCalc Backbone isNan _ ol THREE performance google ga fbq TRANSLATIONS i18next */
/* eslint quotes:0, space-unary-ops:0, no-alert:0, no-unused-vars:0, no-shadow:0, no-extend-native:0, no-trailing-spaces:0 */

(function(){
    'use strict';

    function showError(errorMsg) {
      $('.email-sending-error').slideDown().find('.error-msg-text').text(errorMsg).focus();
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

            $('.email-sending-success').slideUp();
            $('.email-sending-error').slideUp();

            // Disable submit button for a bit
            var submit = container.find('.submit-email');
            submit.attr('disabled', 'disabled');
            setTimeout(function(){
                submit.removeAttr('disabled');
            }, 4000);

            var params = {
                mapUrl: mapUrl,
                meta: meta,
                to: email.val(),
                emailType: emailType
            };
            $.ajax({
                type: "POST",
                url: "https://6ww05s3p8k.execute-api.eu-west-1.amazonaws.com/prod", // FIXME
                contentType: "application/json; charset=utf-8",
                data: JSON.stringify(params)
            }).fail(function(jqXHR, textStatus, errorThrown){
                console.log(jqXHR.status, textStatus, errorThrown);
                showError(textStatus);
            }).done(function(d, textStatus, jqXHR){
                $('.email-sending-success').slideDown().focus();
            });
        });
    }

    window.initEmailSending = initEmailSending;
})();
