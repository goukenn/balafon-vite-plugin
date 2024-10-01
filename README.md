# balafon-vite-plugin

help handling balafon project configuration. 

- author : C.A.D. BONDJE DOUE ([cbondje@igkdev.com])

## require

- balafon php framework
- balafon cli must be installed as global path (and be executable for UNIX system)

> check with this command:

```bash
balafon --version
```

## installation 

```bash
npm -i balafon-vite-plugin
```
or 
```bash
yarn add balafon-vite-plugin
```

Note: this package depend on `cli-color`, `oslllo-svg2` and `vite`

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
    }
}
```