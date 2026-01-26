# SB3 -> OSL

This is a simple tool to convert Scratch 3.0 projects to OSL.

## Usage

change

```js
const project = expandSb3File("Little Square.sb3",{
  assetOptimization: true,
  extractAssets: true
});
```

to the name of an sb3 file in this directory then just run the script with node and a new osl file will be created in the same directory.

## Limitations

- Doesn't support extensions
- Doesn't support touching colour
- Doesn't support pen
- Has limited support for sound
- SVG costumes are often offset
- Effects are kinda broken
- Clones can be a bit buggy

## Credits

[Me!](https://mistium.com)
