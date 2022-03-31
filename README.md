# Extended Fractal Twig Adapter

An adapter that extends the [Fractal Twig](https://github.com/frctl/twig) adapter and introduces sub-render elements in 
context data.

## Installation

```bash
npm install --save-dev https://github.com/das-peter/fractal-twig-context-subrender.git
```

in your `fractal.js`

```js
const fractal = require('@frctl/fractal').create();
const twigAdapter = require('fractal-twig-context-subrender');
const twig = twigAdapter();
```

in your `component.config.yml`

```yaml
status: "ready"
context:
  title: "Filter results"
  action: "/filter-page/"
  headingLevel: "3"
  pageLimit: "25"
  filters:
    - fieldname: "Color"
      filterfrontend: "$filter-types--select"
    - fieldname: "Size"
      filterfrontend:
        "$filter-types--select":
          currentValue: "M"
          values:
            - value: 'S'
              count: 8
            - value: 'M'
              count: 10
            - value: 'L'
              count: 1
          resultCount: 19
```

* `fieldname: "Color"`: the `filterfronted` property will contain the rendered output of the `@filter-types--select` component. 
The component will be rendered with the default / variant context.
* `fieldname: "Size"`: the `filterfronted` property will contain the rendered output of the `@filter-types--select` component. 
The component will be rendered with the context data provided under the key `$filter-types--select`.\
If you defined the key `__importContext` in the context the rendering will do a deep merge of the component context 
with the customized properties. Otherwise it will behave as configured using the `importContext` flag.

<br/>

## The `include` statement 

### To include all the data from another component and assign it to specific variable

```yaml
context: 
  include: 'component-name--variant-name as customVariableName'   
```

### To include object by it's source path

```yaml
context: 
  someDestinationObject:
    include: 'component-name--variant-name.path.to.the.source.data.object'   
```

### To include all object's sub-properties use the `spread ... ` operator

```yaml
context: 
  someDestinationObject:
    include: '...component-name--variant-name'   
```

### To include all object's sub properties - spread operator with source path

```yaml
context: 
  someDestinationObject:
    include: '...component-name--variant-name.some.path'   
```

### To include multiple entries at once

```yaml
context: 
  someDestinationObject:
    include: 'component-name--variant-name.some.path as someCustomVariableName, component-name--variant-name.some.path as anotherCustomVariableName'   
```

### To include multiple entries one by one

```yaml
context: 
  someDestinationObject:
    include1: 'component-name--variant-name.some.path as someCustomVariableName'
    include2: 'component-name--variant-name.some.path as anotherCustomVariableName'  
```

### By default existing variables are not being overriden. To force overriding use `!` operator at the end

```yaml
context: 
  someDestinationObject:
    include: 'component-name--variant-name.some.path!'   
```

```yaml
context: 
  someDestinationObject:
    include: '...component-name--variant-name.some.path!'   
```

```yaml
context: 
  someDestinationObject:
    include: 'component-name--variant-name.some.path as customVariableName!'   
```
