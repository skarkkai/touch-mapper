var fs = require('fs');
var path = require('path');
var Metalsmith = require('metalsmith');
var i18next = require('metalsmith-i18next');
var inPlace = require('metalsmith-in-place');
var concat = require('metalsmith-concat');
var ignore = require('metalsmith-ignore');
var less = require('metalsmith-less')
var copy = require('metalsmith-copy');
var replace = require('metalsmith-text-replace');
var eslint = require("metalsmith-eslint");

function allowPluginErrors(plugin, pluginName) {
    return function(files, metalsmith, done) {
        plugin(files, metalsmith, function(err) {
            if (err) {
                console.warn("Warning: " + pluginName + " failed: " + err.message);
            }
            done();
        });
    };
}

var metalsmith = Metalsmith(__dirname)
    .use(ignore([
        '**/*~',
        '**/*.js.prod',
        '**/*.js.test',
        '**/three-20160121.min.js',
        '**/three-STLLoader-20160122.js',
    ]))
    .use(allowPluginErrors(eslint({
        src: ["**/*.js", "!**/vendor-common/**/*.js", "!**/vendor-other/**/*.js"],
        formatter: "unix",
        eslintConfig: JSON.parse(fs.readFileSync(path.join(process.cwd(), ".eslintrc"), "utf8"))
    }), "eslint"))
    .use(copy({
        pattern: '**/environment.js.dev',
        transform: function (file) {
            return file.replace(/\.[^/.]+$/, "");
        },
        move: true,
    }))
    .use(replace({
        '**/*.ect': {
            find: /{{ ([a-z0-9_]+) }}/gi,
            replace: function(match, str) { return "<%= @t('" + str + "') %>"; }
        }
    }))
    .use(i18next({
        pattern: '*.ect',
        locales: ['de', 'en', 'fi', 'nl'],
        namespaces: ['tm'],
        fallbackLng: 'en',
    }))
    .use(inPlace({
        engine: 'ect',
        pattern:  '**/*.ect',
        rename: true,
    }))
    .use(less({
        pattern: ['**/styles/common.less', '**/styles/index.less', '**/styles/area.less', '**/styles/map.less', '**/styles/help.less'],
        useDynamicSourceMap: true,
    }))
    .use(concat({
        files: ['**/util.js', '**/map-calc.js', '**/model-preview.js', '**/language.js',
                '**/email.js', '**/multipart-mode.js', '**/backbone-helpers.js', '**/map-creation.js',
                '**/osm-preview.js', '**/map-desc-ways.js', '**/map-desc-areas.js', '**/map-desc-pois.js', '**/map-description.js' ],
        output: 'scripts/app-common.js'
    }))
    .use(concat({
        files: ['**/jquery-2.1.4.min.js', '**/underscore-1.13.1.min.js', '**/backbone-1.2.3.min.js', ],
        output: 'scripts/vendor-common.js'
    }))
    .use(copy({ pattern: '**/aws-sdk*.js', directory: 'scripts', move: true, }))
    .use(copy({ pattern: '**/ol-*.js',     directory: 'scripts', move: true, }))
    .use(copy({ pattern: '**/three-r182*.js', directory: 'scripts', move: true, }))
    .use(copy({
        pattern: '**/three-addons/**/*.js',
        directory: 'scripts',
        transform: function (file) {
            return file.replace(/^.*three-addons\//, 'scripts/three-addons/');
        },
        move: true,
    }))
//  .use(permalinks({
//      pattern: ':title'
//  })
    .build(function(err){
        if (err) throw err;
    });
