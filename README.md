# balafon-vite-plugin

## goal
help handling balafon project configuration. 

- author : C.A.D. BONDJE DOUE ([cbondje@igkdev.com])

## require

- `balafon php framework` ([https://balafon.igkdev.com/get-download])
- `balafon` cli must be installed as global path (and be executable for UNIX system)
- `php8+`

> check with this command:

```bash
balafon --version
```

## installation 

```bash
npm -i vite-plugin-balafon
```
or 
```bash
yarn add vite-plugin-balafon
```

Note: this package depend on `cli-color` and `vite`

## usage
- in vite.config.js

```js
import balafon from 'balafon-vite-plugin'

export default defineConfig({
    // ...
    plugins:[
        // ...
        balafon()
    ]
})

```


## in application 

- `virtual:balafon-corejs` : to inject balafon core script. used in development to gain access to `balafon.core.js` library. will inject `$igk` as globalVariable and `globalThis.igk`

-- usage
```js
import 'virtual:balafon-corejs';

$igk(...);
```
- `virtual:balafon-corejs`: inject framework dynamic core css.

- `virtaul:balafon-project-settings` : retrieve controller application session depend of the plugins (dev|production must be dynamic resolved)




## option to pass to balafon config
```json
{
    "leaveIndexHtml": {
        "type":"boolean",
        "description":"do not remove index.html"
    },
    "cwdir":{
        "type":"string",
        "description":"controller working directory"
    },
    "controller":{
        "type":"string",
        "description":"target controller name"
    },
    "defaultUser":{
        "type":"string",
        "description":"login of the user to uses"
    },
    "buildCoreAssetOutput":{
        "type":"string",
        "description": "sub assets folder wher to store core assets. default will be \"balafon/\""
    },
    "buildCoreJSAsAsset":{
        "type":["boolean"],
        "description":"ask to deploy CoreJs as asset"
    },
    "buildCoreCssAsAsset":{
        "type":["boolean"],
        "description":"ask to deploy CoreCss as assets"
    },
    "buildIconLibAsAsset":{
        "type":"boolean",
        "default":false,
        "description":"ask to deploy Icons libraries as assets"
    },
    "icons":{
        "type":"object",
        "description":"manage svg icons for the projects"
    }
}
```


### plugins createApp Override
```js
import { createApp } from 'virtual:balafon-vite-app'
```


```js
import { createSSRApp } from 'virtual:balafon-vite-app'
```


### declerate icons for production 

library: string => [folder_that_contains_svg_or_vue, list_of_file_to_import] 

