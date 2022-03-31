'use strict';

const Fractal = require('@frctl/fractal');
const _ = require('lodash');
const Path = require('path');
const utils = Fractal.utils;

class TwigAdapter extends Fractal.Adapter {

    constructor(Twig, source, app, config) {

        super(Twig, source);
        this._app = app;
        this._config = config;

        let self = this;

        Twig.extend(function(Twig) {

            /*
             * Register a Fractal template loader. Locations can be handles or paths.
             */

            Twig.Templates.registerLoader('fractal', function(location, params, callback, errorCallback) {

                let parser = Twig.Templates.parsers['twig'];

                if (params.precompiled) {
                    params.data = params.precompiled;
                } else {
                    let view = isHandle(location) ? self.getView(location) : _.find(self.views, {path: Path.join(source.fullPath, location)});
                    if (!view) {

                        throw new Error(`Template ${location} not found`);
                    }
                    params.data = view.content;
                }

                return new Twig.Template(params);
            });

            /*
             * Monkey patch the render method to make sure that the _self variable
             * always refers to the actual component/sub-component being rendered.
             * Without this _self would always refer to the root component.
             */

            const render = Twig.Template.prototype.render;
            Twig.Template.prototype.render = function(context, params) {

                if (!self._config.pristine && this.id) {

                    let handle = null;

                    if (isHandle(this.id)) {
                        handle = this.id;
                    } else {
                        let view = _.find(self.views, {path: Path.join(source.fullPath, this.id)});
                        if (view) {
                            handle = view.handle;
                        }
                    }

                    if (handle) {
                        let prefixMatcher = new RegExp(`^\\${self._config.handlePrefix}`);
                        let entity = source.find(handle.replace(prefixMatcher, '@'));
                        if (entity) {
                            entity = entity.isVariant ? entity : entity.variants().default();
                            if (config.importContext) {
                                // Might causes maximum call stack error.
                                context = utils.defaultsDeep(_.cloneDeep(context), entity.getContext());
                                context._self = entity.toJSON();
                                setKeys(context);
                            }
                            let yaml_context = process_context(entity, context);
                            setKeys(yaml_context);
                        }
                    }
                }

                /*
                 * Twig JS uses an internal _keys property on the context data
                 * which we need to regenerate every time we patch the context.
                 */

                function setKeys(obj) {

                    obj._keys = _.compact(_.map(obj, (val, key) => {
                        return (_.isString(key) && ! key.startsWith('_')) ? key : undefined;
                    }));
                    _.each(obj, (val, key) => {
                        if (_.isPlainObject(val) && (_.isString(key) && ! key.startsWith('_'))) {
                            setKeys(val);
                        }
                    });
                }

                return render.call(this, context, params);
            };

            /*
             * Twig caching is enabled for better perf, so we need to
             * manually update the cache when a template is updated or removed.
             */

            Twig.cache = false;

            self.on('view:updated', unCache);
            self.on('view:removed', unCache);
            self.on('wrapper:updated', unCache);
            self.on('wrapper:removed', unCache);

            function unCache(view) {
                let path = Path.relative(source.fullPath, _.isString(view) ? view : view.path);
                if (view.handle && Twig.Templates.registry[view.handle]) {
                    delete Twig.Templates.registry[view.handle];
                }
                if (Twig.Templates.registry[path]) {
                    delete Twig.Templates.registry[path];
                }
            }

        });

        function getDataByPath(object, path, omitLastElement) {
            if (path === null) {
                return object;
            }

            const pathParts = path.split('.');

            if (omitLastElement) {
                pathParts.pop();
            }

            let currentValue = object;
            for (let i = 0; i < pathParts.length; i++) {
                const pathPart = pathParts[i];
                currentValue = currentValue[pathPart];
            }

            return currentValue;
        }

        // Example input: component-name--variant-name.path.to.the.source.data.object
        // As a result we retrieve information about the context name (component-name--variant-name), full object path (path.to.the.source.data.object) and the final property name (object)
        function fullDataPath2Info(fullDataPath) {
            const componentName_dataPath = fullDataPath.split(/\.(.*)/s);
            const pathParts = fullDataPath.split('.');
            if (pathParts.length > 1) {
                return { contextName: componentName_dataPath[0], path: componentName_dataPath[1], lastPart: pathParts[pathParts.length - 1] };
            } else {
                return { contextName: componentName_dataPath[0], path: null, lastPart: null };
            }
        }

        /* eslint-disable complexity */
        // Goes throught the whole context data tree and turns all includes into a desired data.
        function processIncludes(destinationDataNode) {
            if (typeof destinationDataNode === 'object') {

                for (let propertyName in destinationDataNode) {
                    if (propertyName.startsWith('include')) {

                        let fullDataPaths = destinationDataNode[propertyName];

                        if (fullDataPaths.startsWith) {
                            for (let fullDataPath of fullDataPaths.split(',')) {
                                fullDataPath = fullDataPath.trim();

                                // Indicates whether inner properties of the source data should be spread.
                                let spreadInnerData = fullDataPath.startsWith('...');
                                // Indicates whether the include data has a priority over already existing data.
                                const overrideExistingData = fullDataPath.endsWith('!');
                                // Allows for property rename. Helpfull especially when including full context data which doesn't have a name.
                                const definedCustomPropertyName = fullDataPath.indexOf(' as ') !== -1;

                                let customPropertyName = null;

                                if (spreadInnerData) {
                                    fullDataPath = fullDataPath.slice(3);
                                }

                                if (overrideExistingData) {
                                    fullDataPath = fullDataPath.slice(0, -1);
                                }

                                if (definedCustomPropertyName) {
                                    const fullDataPath_customPropertyName = fullDataPath.split(" as ")
                                    fullDataPath = fullDataPath_customPropertyName[0]
                                    customPropertyName = fullDataPath_customPropertyName[1]

                                    // In case we specify variable name, the spread operator doesn't make sense in the current implementation.
                                    spreadInnerData = false
                                }

                                const contextDataPathInfo = fullDataPath2Info(fullDataPath);

                                const sourceComponentContextData = getEntityInfoByName(self._config.handlePrefix + contextDataPathInfo.contextName).contextData;
                                const sourceData = getDataByPath(sourceComponentContextData, contextDataPathInfo.path, !spreadInnerData);

                                if (spreadInnerData) {
                                    // Iterates all inner properties and add them to the destination object.

                                    for (let sourceDataPropertyName in sourceData) {
                                        if ((overrideExistingData || typeof destinationDataNode[sourceDataPropertyName] === 'undefined') && typeof sourceData[sourceDataPropertyName] !== 'undefined') {
                                            destinationDataNode[sourceDataPropertyName] = sourceData[sourceDataPropertyName];
                                        }
                                    }
                                } else {
                                    // In this case, it takes the whole sub-property by the requested property name (sourceDataPropertyName). 
                                    // In case property name is not specified the whole object is used.

                                    const sourceDataPropertyName = contextDataPathInfo.lastPart;
                                    const finalDestinationPropertyName = customPropertyName || sourceDataPropertyName

                                    if ((overrideExistingData || typeof destinationDataNode[finalDestinationPropertyName] === 'undefined') && (!sourceDataPropertyName || typeof sourceData[sourceDataPropertyName] !== 'undefined')) {
                                        destinationDataNode[finalDestinationPropertyName] = sourceDataPropertyName ? sourceData[sourceDataPropertyName] : sourceData;
                                    }
                                }

                            }

                            // Removes "include" entry that is not needed anymore.
                            delete destinationDataNode[propertyName];
                        }
                    } else {
                        // Recursively processing the sub-tree.
                        const subObject = destinationDataNode[propertyName];

                        if (Array.isArray(subObject)) {
                            for (let subObjectPropertyName in subObject) {
                                // Processing each element in the array.
                                processIncludes(subObject[subObjectPropertyName]);
                            }
                        } else {
                            if (typeof subObject === 'object') {
                                // Processing sub-objects.
                                processIncludes(subObject);
                            }
                        }
                    }
                }
            }

            return destinationDataNode;
        }

        function getEntityInfoByName(item) {
            let item_id = item.trim().replace('$', self._config.handlePrefix);
            let entity = source.find(item_id);
            if (typeof entity === 'undefined') {
                throw new Error(`Sub-Render item ${item_id} not found`);
            }
            return { entity: entity.isVariant ? entity : entity.variants().default(), item_id: item_id, contextData: entity.getContext() };
        }

        function isHandle(str) {
            return str && str.startsWith(self._config.handlePrefix);
        }

        function process_context(entity, context) {
            for (let key in context) {
                let type = typeof context[key];
                if (key.startsWith('$')) {
                    // This is a subrender element with custom context. Replaces the whole context object with the rendered
                    // output.
                    context = render_sub_component(key, context[key]);
                } else if (type === 'string' && context[key].startsWith('$')) {
                    // Simple subrender element with the default context data because we can't define context anyways.
                    // Replaces the value of the context with the rendered output.
                    context[key] = render_sub_component(context[key], {__importContext: true});
                } else if (context[key] !== null && (type === 'object' || type === 'array')) {
                    // Search recursively for context render configs.
                    context[key] = process_context(entity, context[key]);
                }
            }

            // Handling includes 
            return  processIncludes( context ) ;
        }

        function render_sub_component(item, context) {
            const entityInfo = getEntityInfoByName(item);
            const entity = entityInfo.entity;
            if (context['__importContext']) {
                // Might causes maximum call stack error.
                context = utils.defaultsDeep(_.cloneDeep(context), entity.getContext());
                context._self = entity.toJSON();
            }

            let template = self.engine.twig({
                method: 'fractal',
                async: false,
                rethrow: true,
                name: entityInfo.item_id,
                str: entity.content,
                namespaces: self._config.namespaces || {}
            });

            return template.render(context);
        }

    }

    get twig() {
        return this._engine;
    }

    render(path, str, context, meta) {

        let self = this;

        meta = meta || {};

        if (!this._config.pristine) {
            setEnv('_self', meta.self, context);
            setEnv('_target', meta.target, context);
            setEnv('_env', meta.env, context);
            setEnv('_config', this._app.config(), context);
        }

        return new Promise(function(resolve, reject){

            let tplPath = Path.relative(self._source.fullPath, path);

            try {
                let template = self.engine.twig({
                    method: 'fractal',
                    async: false,
                    rethrow: true,
                    name: meta.self ? `${self._config.handlePrefix}${meta.self.handle}` : tplPath,
                    precompiled: str,
                    namespaces: self._config.namespaces || {}
                });
                resolve(template.render(context));
            } catch (e) {
                reject(new Error(e));
            }

        });

        function setEnv(key, value, context) {
            if (context[key] === undefined && value !== undefined) {
                context[key] = value;
            }
        }
    }

}

module.exports = function(config) {

    config = _.defaults(config || {}, {
        pristine: false,
        handlePrefix: '@',
        importContext: false
    });

    return {

        register(source, app) {

            const Twig = require('twig');

            if (!config.pristine) {
                _.each(require('./functions')(app) || {}, function(func, name){
                    Twig.extendFunction(name, func);
                });
                _.each(require('./filters')(app), function(filter, name){
                    Twig.extendFilter(name, filter);
                });
                _.each(require('./tests')(app), function(test, name){
                    Twig.extendTest(name, test);
                });
                Twig.extend(function(Twig) {
                    _.each(require('./tags')(app), function(tag){
                        Twig.exports.extendTag(tag(Twig));
                    });
                });
            }

            _.each(config.functions || {}, function(func, name){
                Twig.extendFunction(name, func);
            });
            _.each(config.filters || {}, function(filter, name){
                Twig.extendFilter(name, filter);
            });
            _.each(config.tests || {}, function(test, name){
                Twig.extendTest(name, test);
            });
            Twig.extend(function(Twig) {
                _.each(config.tags || {}, function(tag){
                    Twig.exports.extendTag(tag(Twig));
                });
            });

            const adapter = new TwigAdapter(Twig, source, app, config);

            adapter.setHandlePrefix(config.handlePrefix);

            return adapter;
        }
    }

};
