const fs = require('fs');
const path = require('path');
const JSZip = require('node-zip');

const defaultEffect = { transparency: 0, colour: 0, brightness: 0, fisheye: 0, pixelate: 0 }

function getMimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.svg': return 'image/svg+xml';
    case '.gif': return 'image/gif';
    default: return 'application/octet-stream';
  }
}

function expandSb3File(name) {
  try {
    const sb3FilePath = path.join(__dirname, name);

    if (!fs.existsSync(sb3FilePath)) {
      console.error(`File not found: ${sb3FilePath}`);
      return;
    }

    console.log(`Found file: ${sb3FilePath}`);

    const data = fs.readFileSync(sb3FilePath);

    const zip = new JSZip(data, { base64: false, checkCRC32: true });

    console.log('\nContents of the SB3 file:');
    let index = 1;
    for (const filename in zip.files) {
      const entry = zip.files[filename];
      console.log(`${index}. ${filename} ${entry.dir ? '(directory)' : '(file)'}`);
      index++;
    }

    const project = JSON.parse(zip.files["project.json"].asText());

    project.targets.forEach((target, index) => {
      target.costumes.forEach((costume, costumeIndex) => {
        const costumeFile = zip.files[costume.md5ext];
        if (costumeFile) {
          const binary = costumeFile.asBinary();
          const base64Data = Buffer.from(binary, 'binary').toString('base64');
          const mimeType = getMimeType(costume.md5ext);
          costume.data = `data:${mimeType};base64,${base64Data}`;
        }
      })
      target.sounds.forEach((sound, soundIndex) => {
        const soundFile = zip.files[sound.md5ext];
        if (soundFile) {
          const binary = soundFile.asBinary();
          const base64Data = Buffer.from(binary, 'binary').toString('base64');
          const mimeType = getMimeType(sound.md5ext);
          sound.data = `data:${mimeType};base64,${base64Data}`;
        }
      });
    });

    project.name = name.replace('.sb3', '');

    return project;

  } catch (error) {
    console.error('Error processing the SB3 file:', error);
  }
}

let blocks = []
let current_target = 0;
let variable_names = {};
let list_names = {};
let blockProcessingStack = [];

function escapeString(str) {
  return str.replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function resolveInput(input) {
  if (!input) {
    return new ConstantInput(0);
  }

  if (!Array.isArray(input)) {
    if (typeof input === 'number') return new ConstantInput(input);
    if (typeof input === 'string') return new ConstantInput(`${escapeString(input)}`);
    return new ConstantInput(input || 0);
  }

  if (input.length === 0) return new ConstantInput(0);

  switch (input[0]) {
    case 1:  // Block reference or direct value
      if (Array.isArray(input[1])) {
        // Handle direct values with proper type conversion
        const value = input[1][1];
        if (typeof value === 'number') return new ConstantInput(value, TYPES.NUMBER);
        if (typeof value === 'string') return new ConstantInput(value, TYPES.STRING);
        return new ConstantInput(value || 0, TYPES.NUMBER);
      } else {
        // Handle block reference with caching for performance
        if (!blocks[input[1]]) {
          console.warn(`Block reference ${input[1]} not found in target ${current_target}`);
          return new ConstantInput(0, TYPES.NUMBER);
        }
        // Check for circular references to avoid infinite recursion
        if (blockProcessingStack.includes(input[1])) {
          console.warn(`Circular reference detected for block ${input[1]}`);
          return new ConstantInput(0, TYPES.NUMBER);
        }
        blockProcessingStack.push(input[1]);
        const result = resolveBlock(blocks[input[1]]);
        blockProcessingStack.pop();
        return result;
      }

    case 2:  // Block reference by ID
      // Better error handling if the block doesn't exist
      if (!blocks[input[1]]) {
        console.warn(`Block reference ${input[1]} not found in target ${current_target}`);
        return new ConstantInput(0, TYPES.NUMBER);
      }
      // Check for circular references
      if (blockProcessingStack.includes(input[1])) {
        console.warn(`Circular reference detected for block ${input[1]}`);
        return new ConstantInput(0, TYPES.NUMBER);
      }
      blockProcessingStack.push(input[1]);
      const result2 = resolveBlock(blocks[input[1]]);
      blockProcessingStack.pop();
      return result2;

    case 3:  // Reporter block
      // Handle case where input[1] is an array (nested reporter)
      if (Array.isArray(input[1])) {
        // Handle various reporter types based on first element
        if ([12, 13].includes(input[1][0])) {
          return resolveInput(input[1]);
        }
        // Handle shadow value with direct reporter
        if (input[1][0] === 10) {
          return new ConstantInput(`${escapeString(input[1][1] || "")}`, TYPES.STRING);
        }
        if (input[1][0] === 4 || input[1][0] === 5) {
          const num = Number(input[1][1]);
          return new ConstantInput(isNaN(num) ? 0 : num, TYPES.NUMBER);
        }
        // Handle other nested reporter types
        return resolveInput(input[1]);
      }

      // Better error handling for missing blocks
      if (!blocks[input[1]]) {
        console.warn(`Reporter block ${input[1]} not found in target ${current_target}`);
        return new ConstantInput(0, TYPES.NUMBER);
      }

      // Check for circular references
      if (blockProcessingStack.includes(input[1])) {
        console.warn(`Circular reference detected for block ${input[1]}`);
        return new ConstantInput(0, TYPES.NUMBER);
      }

      blockProcessingStack.push(input[1]);
      const result3 = resolveBlock(blocks[input[1]]);
      blockProcessingStack.pop();
      return result3;

    case 4:  // Number input
    case 5:  // Positive number input
    case 6:  // Positive integer input
    case 7:  // Integer input
    case 8:  // Angle input
      // More robust number parsing with validation and constraints
      let numValue = input[1] !== undefined ? Number(input[1]) : 0;
      if (isNaN(numValue)) numValue = 0;

      // Apply constraints based on input type
      if (input[0] === 5 || input[0] === 6) { // Positive numbers
        numValue = Math.max(0, numValue);
      }
      if (input[0] === 6 || input[0] === 7) { // Integers
        numValue = Math.round(numValue);
      }
      if (input[0] === 8) { // Angle: normalize to 0-360
        numValue = ((numValue % 360) + 360) % 360;
      }

      return new ConstantInput(numValue, TYPES.NUMBER);

    case 9:  // Color input
      // Ensure color has proper format with full validation
      if (!input[1]) return new ConstantInput('#000000', TYPES.STRING);

      // Check if already has # prefix
      const colorStr = input[1].toString();
      if (colorStr.startsWith('#')) return new ConstantInput(colorStr, TYPES.STRING);

      // Verify it's a valid hex color and normalize to 6 digits
      const isValidHex = /^[0-9A-Fa-f]{3,8}$/.test(colorStr);
      if (!isValidHex) return new ConstantInput('#000000', TYPES.STRING);

      return new ConstantInput(`#${colorStr}`, TYPES.STRING);

    case 10:  // String input
      // Comprehensive string escaping for all potential issues
      return new ConstantInput(`${escapeString(input[1] || "")}`, TYPES.STRING);

    case 11:  // Broadcast input
      // Full broadcast name validation and normalization
      if (!input[1]) return new ConstantInput('', TYPES.STRING);

      // If it's already a reference to a broadcast ID, process it
      if (Array.isArray(input[1]) && input[1][0] === 11) {
        return new ConstantInput(`${escapeString(input[1][1] || "")}`, TYPES.STRING);
      }

      return new ConstantInput(`${escapeString(input[1].toString())}`, TYPES.STRING);

    case 12: { // Variable reference
      // Store the variable name for later reference
      variable_names[input[2]] = input[1];
      const targetStr = getTargetForVariable(input[2], current_target);
      
      const knownType = typeTracker.getVariableType(input[2]);
      return new TypedInput(`${targetStr}.variables["${input[1]}"]`, knownType);
    }

    case 13: { // List reference
      // Add safety check for list target existence
      const targetStr = getTargetForList(input[2], current_target);
      return new TypedInput(`${targetStr}.lists["${input[1]}"]`, TYPES.UNKNOWN);
    }

    default:
      // Special case for arrays we don't recognize
      if (Array.isArray(input)) {
        console.warn(`Unknown input type: ${input[0]}`);
        // Try to extract something useful
        if (input.length > 1) {
          if (typeof input[1] === 'number') return new ConstantInput(input[1], TYPES.NUMBER);
          if (typeof input[1] === 'string') return new ConstantInput(input[1], TYPES.STRING);
          if (Array.isArray(input[1])) return resolveInput(input[1]);
        }
      }

      // For numbers or strings, return them directly with proper typing
      if (typeof input === 'number') return new ConstantInput(input, TYPES.NUMBER);
      if (typeof input === 'string') return new ConstantInput(input, TYPES.STRING);

      // Default fallback value based on context
      console.warn(`Unhandled input type, using default value`);
      return new ConstantInput(0, TYPES.NUMBER);
  }
}

function convertEffectForOSL(effect) {
  switch (effect) {
    case 'GHOST': return 'transparency';
    case 'COLOR': return 'colour';
    case 'BRIGHTNESS': return 'brightness';
    case 'FISHEYE': return 'sharpness';
    case 'PIXELATE': return 'pixelate';
    default: return effect;
  }
}

/**
 * Helper function to process C-shaped blocks
 */
function processCBlock(block, target, subStackKey = 'SUBSTACK') {
  let source = '';
  if (!block.inputs[subStackKey]) return source;

  let current = blocks[block.inputs[subStackKey][1]];
  while (current) {
    const next = current.next;
    current.next = null;
    source += resolveBlock(current, target);
    if (!next) break;
    current = blocks[next];
  }
  return source;
}

function getTargetForVariable(variableId, current_target) {
  const num = globalThis.file.targets.filter(v => typeof v.variables[variableId] !== 'undefined')[0]?.num;

  if (num === 1) return "stage";
  if (num === current_target) return "target";

  return `targets[${num}]`;
}

function getTargetForList(listId, current_target) {
  const num = globalThis.file.targets.filter(v => typeof v.lists[listId] !== 'undefined')[0]?.num;

  if (num === 1) return "stage";
  if (num === current_target) return "target";

  return `targets[${num}]`;
}

const TYPES = {
  NUMBER: 1,
  STRING: 2,
  BOOLEAN: 3,
  UNKNOWN: 4,
}

class Input {
  constructor(value) {
    this.value = value;
  }

  toString() {
    return `${this.input}.toStr()`;
  }

  toBool() {
    return `${this.input}.toBool()`;
  }

  toNum() {
    return `${this.input}.toNum()`;
  }

  toUnknown() {
    return this.input;
  }

  isConstant(value) {
    return false;
  }
}
class ConstantInput extends Input {
  constructor(value, type) {
    super(value);
    this.rawValue = value;
    this.value = `${value}`;
    this.type = type;
  }

  toString() {
    return JSON.stringify(this.value);
  }

  toBool() {
    return `${this.value.toLowerCase() === "true"}`;
  }

  toNum() {
    return `${+this.value || 0}`;
  }

  toUnknown() {
    if (this.type === TYPES.STRING) return `"${this.value}"`;
    return this.value;
  }

  isConstant(value) {
    if (typeof value === 'number') return parseFloat(this.value) === value;
    return this.value === value;
  }
}

class TypedInput extends Input {
  constructor(value, type) {
    super(value);
    this.type = type;
  }

  toString() {
    if (this.type === TYPES.STRING) return `${this.value}`;
    return `${this.value}.toStr()`;
  }

  toBool() {
    if (this.type === TYPES.BOOLEAN) return `${this.value}`;
    return `${this.value}.toBool()`;
  }

  toNum() {
    if (this.type === TYPES.NUMBER) return `${this.value}`;
    return `${this.value}.toNum()`;
  }

  toUnknown() {
    return this.value;
  }

  isConstant(value) {
    return false;
  }
}

class Optimizer {
  constructor() {
    this.constantsEvaluated = 0;
    this.deadCodeRemoved = 0;
  }

  foldBinaryOp(opcode, left, right) {
    if (!(left instanceof ConstantInput && right instanceof ConstantInput)) {
      return null;
    }

    const l = parseFloat(left.value);
    const r = parseFloat(right.value);
    let result;

    switch (opcode) {
      case 'operator_add': result = l + r; break;
      case 'operator_subtract': result = l - r; break;
      case 'operator_multiply': result = l * r; break;
      case 'operator_divide': result = l / r; break;
      case 'operator_mod': result = l % r; break;
      case 'operator_gt': return new ConstantInput(l > r, TYPES.BOOLEAN);
      case 'operator_lt': return new ConstantInput(l < r, TYPES.BOOLEAN);
      case 'operator_equals': 
        return new ConstantInput(left.value === right.value, TYPES.BOOLEAN);
      default: return null;
    }

    this.constantsEvaluated++;
    return new ConstantInput(result, TYPES.NUMBER);
  }

  simplifyAdd(left, right) {
    if (left.isConstant(0)) return right;
    if (right.isConstant(0)) return left;
    return null;
  }

  simplifyMultiply(left, right) {
    if (left.isConstant(0) || right.isConstant(0)) {
      this.deadCodeRemoved++;
      return new ConstantInput(0, TYPES.NUMBER);
    }
    if (left.isConstant(1)) return right;
    if (right.isConstant(1)) return left;
    return null;
  }

  simplifySubtract(left, right) {
    if (right.isConstant(0)) return left;
    return null;
  }

  simplifyDivide(left, right) {
    if (right.isConstant(1)) return left;
    if (left.isConstant(0)) {
      this.deadCodeRemoved++;
      return new ConstantInput(0, TYPES.NUMBER);
    }
    return null;
  }
}

const optimizer = new Optimizer();

function resolveBlock(block, target) {
  if (!block) return "";

  let source = "";

  try {
    switch (block.opcode) {
      case 'event_whenflagclicked': {
        while (block.next) {
          block = blocks[block.next];
          source += resolveBlock(block, target);
        }
        return `void target.greenflag.append({id: ouidNew(), code: def(target) -> (\n${source})})\n`;
      } case 'event_whenkeypressed': {
        const key = block.fields.KEY_OPTION[0];
        while (block.next) {
          block = blocks[block.next];
          source += resolveBlock(block, target);
        }
        return `target.keyPressed["${key}"] ??= []\nvoid target.keyPressed["${key}"].append({id: ouidNew(), code: def(target) -> (\n${source})})\n`;
      } case 'motion_goto': {
        const target = resolveInput(block.inputs.TO);
        if (target.isConstant('_mouse_')) {
          return `target.gotoXY(mouse_x, mouse_y)\n`;
        } else if (target.isConstant('_random_')) {
          return `target.gotoXY(random(-240, 240), random(-180, 180))\n`;
        }

        return `target.goto(getTargetByName(${target.toString()}))\n`;
      } case 'motion_goto_menu': {
        return new ConstantInput(`${block.fields.TO[0]}`, TYPES.STRING);
      } case 'motion_gotoxy': {
        return `target.gotoXY(${resolveInput(block.inputs.X).toNum()}, ${resolveInput(block.inputs.Y).toNum()})\n`;
      } case 'motion_ifonedgebounce': {
        return `ifOnEdgeBounce(target)\n`;
      } case 'motion_movesteps': {
        const steps = resolveInput(block.inputs.STEPS);
        if (steps.isConstant(0)) return '';
        return `target.moveSteps(${steps.toNum()})\n`;
      } case 'motion_turnright': {
        const degrees = resolveInput(block.inputs.DEGREES);
        if (degrees.isConstant(0)) return '';
        return `target.direction += ${degrees.toNum()}\n`;
      } case 'motion_turnleft': {
        const degrees = resolveInput(block.inputs.DEGREES);
        if (degrees.isConstant(0)) return '';
        return `target.direction -= ${degrees.toNum()}\n`;
      } case 'motion_setrotationstyle': {
        return `target.rotationStyle = "${block.fields.STYLE[0]}"\n`;
      } case 'motion_setx': {
        return `target.gotoXY(${resolveInput(block.inputs.X).toNum()}, target.y)\n`;
      } case 'motion_sety': {
        return `target.gotoXY(target.x, ${resolveInput(block.inputs.Y).toNum()})\n`;
      } case 'motion_changexby': {
        const changeX = resolveInput(block.inputs.DX).toNum();
        return `target.gotoXY(target.x + ${changeX}, target.y)\n`;
      } case 'motion_changeyby': {
        const changeY = resolveInput(block.inputs.DY).toNum();
        return `target.gotoXY(target.x, target.y + ${changeY})\n`;
      } case 'motion_pointindirection': {
        const direction = resolveInput(block.inputs.DIRECTION).toNum();
        return `target.direction = ${direction}\n`;
      } case 'motion_pointtowards': {
        const target = resolveInput(block.inputs.TOWARDS);
        if (target === '_mouse_') {
          return `goto target.x target.y\npointat mouse_x mouse_y\ntarget.direction = direction\n`;
        } else {
          return `goto target.x target.y\npointat getTargetByName(${target}).x getTargetByName(${target}).y\ntarget.direction = direction\n`;
        }
      } case 'motion_pointtowards_menu': {
        return new ConstantInput(`${block.fields.TOWARDS[0]}`, TYPES.STRING);
      } case 'motion_direction': {
        return new TypedInput(`target.direction`, TYPES.NUMBER);
      } case 'motion_xposition': {
        return new TypedInput(`target.x`, TYPES.NUMBER);
      } case 'motion_yposition': {
        return new TypedInput(`target.y`, TYPES.NUMBER);
      } case 'data_setvariableto': {
        const variableName = block.fields.VARIABLE[0];
        const variableId = block.fields.VARIABLE[1];
        variable_names[variableId] = variableName;

        const value = resolveInput(block.inputs.VALUE);
        const targetStr = getTargetForVariable(variableId, current_target);

        return `${targetStr}.variables["${variableName}"] = ${value.toUnknown()}\n`;
      } case 'data_changevariableby': {
        const variableName = block.fields.VARIABLE[0];
        const variableId = block.fields.VARIABLE[1];
        variable_names[variableId] = variableName;

        const value = resolveInput(block.inputs.VALUE);
        const targetStr = getTargetForVariable(variableId, current_target);
        const varStr = `${targetStr}.variables["${variableName}"]`

        return `${varStr} = ${varStr}.toNum() + ${value.toNum()}\n`;
      } case 'data_showvariable': {
        const variableName = block.fields.VARIABLE[0];
        const variableId = block.fields.VARIABLE[1];

        const targetStr = getTargetForVariable(variableId, current_target);
        return `setMonitorVisible(${targetStr == "stage" ? 'null' : targetStr + ".name"}, "${variableName}", true)\n`;
      } case 'data_hidevariable': {
        const variableName = block.fields.VARIABLE[0];
        const variableId = block.fields.VARIABLE[1];

        const targetStr = getTargetForVariable(variableId, current_target);
        return `setMonitorVisible(${targetStr == "stage" ? 'null' : targetStr + ".name"}, "${variableName}", false)\n`;
      } case 'data_lengthoflist': {
        const listName = block.fields.LIST[0];
        const listId = block.fields.LIST[1];
        list_names[listId] = listName;

        const targetStr = getTargetForList(listId, current_target);

        return new TypedInput(`${targetStr}.lists["${listName}"].len`, TYPES.NUMBER);
      } case 'data_itemoflist': {
        const listName = block.fields.LIST[0];
        const listId = block.fields.LIST[1];
        list_names[listId] = listName;

        const index = resolveInput(block.inputs.INDEX).toNum();
        const targetStr = getTargetForList(listId, current_target);

        return new TypedInput(`${targetStr}.lists["${listName}"][${index}]`, TYPES.UNKNOWN);
      } case 'data_deleteoflist': {
        const listName = block.fields.LIST[0];
        const listId = block.fields.LIST[1];
        list_names[listId] = listName

        const index = resolveInput(block.inputs.INDEX);
        const targetStr = getTargetForList(listId, current_target);

        if (index.isConstant(1)) {
          return `void ${targetStr}.lists["${listName}"].shift()\n`;
        } else if (index.isConstant("all")) {
          return `${targetStr}.lists["${listName}"] = []\n`;
        }
        return `void ${targetStr}.lists["${listName}"].delete(${index.toNum()})\n`;
      } case 'data_addtolist': {
        const listName = block.fields.LIST[0];
        const listId = block.fields.LIST[1];
        list_names[listId] = listName;

        const item = resolveInput(block.inputs.ITEM).toUnknown();
        const targetStr = getTargetForList(listId, current_target);

        return `void ${targetStr}.lists["${listName}"].append(${item})\n`;
      } case 'data_itemoflist': {
        const listName = block.fields.LIST[0];
        const listId = block.fields.LIST[1];
        list_names[listId] = listName;

        const index = resolveInput(block.inputs.INDEX);
        const targetStr = getTargetForList(listId, current_target);

        return new TypedInput(`${targetStr}.lists["${listName}"][${index}]`, TYPES.UNKNOWN);
      } case 'data_deletealloflist': {
        const listName = block.fields.LIST[0];
        const listId = block.fields.LIST[1];
        list_names[listId] = listName

        const targetStr = getTargetForList(listId, current_target);

        return `${targetStr}.lists["${listName}"] = []\n`;
      } case 'data_listcontainsitem': {
        const listName = block.fields.LIST[0];
        const listId = block.fields.LIST[1];
        list_names[listId] = listName;

        const item = resolveInput(block.inputs.ITEM);
        const targetStr = getTargetForList(listId, current_target);

        return new TypedInput(`${targetStr}.lists["${listName}"].contains(${item})`, TYPES.BOOLEAN);
      } case 'data_replaceitemoflist': {
        const listName = block.fields.LIST[0];
        const listId = block.fields.LIST[1];
        list_names[listId] = listName;

        const index = resolveInput(block.inputs.INDEX).toNum();
        const item = resolveInput(block.inputs.ITEM).toUnknown();
        const targetStr = getTargetForList(listId, current_target);

        return `${targetStr}.lists["${listName}"][${index}] = ${item}\n`;
      } case 'data_insertitemoflist': {
        const listName = block.fields.LIST[0];
        const listId = block.fields.LIST[1];
        list_names[listId] = listName;

        const index = resolveInput(block.inputs.INDEX).toNum();
        const item = resolveInput(block.inputs.ITEM).toUnknown();
        const targetStr = getTargetForList(listId, current_target);

        return `void ${targetStr}.lists["${listName}"].insert(${index}, ${item})\n`;
      } case 'data_showlist': {
        const listName = block.fields.LIST[0];
        const listId = block.fields.LIST[1];
        list_names[listId] = listName;

        const targetStr = getTargetForList(listId, current_target);
        return `setMonitorVisible(${targetStr == "stage" ? 'null' : targetStr + ".name"}, "${listName}", true)\n`;
      } case 'data_hidelist': {
        const listName = block.fields.LIST[0];
        const listId = block.fields.LIST[1];
        list_names[listId] = listName;

        const targetStr = getTargetForList(listId, current_target);
        return `setMonitorVisible(${targetStr == "stage" ? 'null' : targetStr + ".name"}, "${listName}", false)\n`;
      } case 'data_itemnumoflist': {
        const listName = block.fields.LIST[0];
        const listId = block.fields.LIST[1];
        list_names[listId] = listName;

        const targetStr = getTargetForList(listId, current_target);

        return new TypedInput(`${targetStr}.lists["${listName}"].index(${resolveInput(block.inputs.ITEM).toUnknown()})`, TYPES.NUMBER);
      } case 'data_insertatlist': {
        const listName = block.fields.LIST[0];
        const listId = block.fields.LIST[1];
        list_names[listId] = listName;

        const index = resolveInput(block.inputs.INDEX).toNum();
        const item = resolveInput(block.inputs.ITEM).toUnknown();
        const targetStr = getTargetForList(listId, current_target);

        return `void ${targetStr}.lists["${listName}"].insert(${index}, ${item})\n`;
      } case 'control_forever': {
        const body = processCBlock(block, target);
        return `void target.frame.append({id: ouidNew(), code: def(target) -> (\n${body})})\n`;
      } case 'control_if': {
        if (block.inputs.CONDITION === undefined) return '';
        const condition = resolveBlock(blocks[block.inputs.CONDITION[1]], target).toBool();
        const body = processCBlock(block, target);
        return `if ${condition} (\n${body})\n`;
      } case 'control_if_else': {
        const elseBranch = processCBlock(block, target, 'SUBSTACK2');
        if (block.inputs.CONDITION === undefined) return elseBranch;
        const condition = resolveBlock(blocks[block.inputs.CONDITION[1]], target).toBool();
        const ifBranch = processCBlock(block, target);
        return `if ${condition} (\n${ifBranch}) else (\n${elseBranch})\n`;
      } case 'control_for_each': {
        const list = resolveInput(block.inputs.LIST).toString();
        const variable = block.fields.VARIABLE[0];
        const body = processCBlock(block, target);
        return `for i ${list}.len (\n${variable} @= ${list}[i]\n${body})\n`;
      } case 'control_while': {
        const condition = resolveBlock(blocks[block.inputs.CONDITION[1]], target).toBool();
        const body = processCBlock(block, target);
        return `while ${condition} (\n${body}defer\n)\n`;
      } case 'control_delete_this_clone': {
        return `void targets.delete(targets.index(target))\nvoid renderOrder.delete(renderOrder.index(target))\ncloneCount --\n`;
      } case 'event_whenthisspriteclicked': {
        while (block.next) {
          const next = block.next;
          block.next = null;
          block = blocks[next];
          source += resolveBlock(block, target);
        }
        return `void target.onclick.append({id: ouidNew(), code: def(target) -> (\n${source})}\n)\n`;
      } case 'event_broadcast': {
        const message = resolveInput(block.inputs.BROADCAST_INPUT).toString()
        return `broadcast(${message})\n`;
      } case 'event_broadcastandwait': {
        const message = resolveInput(block.inputs.BROADCAST_INPUT).toString()
        return `broadcastAndWait(${message})\n`;
      } case 'control_repeat_until': {
        const condition = resolveBlock(blocks[block.inputs.CONDITION[1]], target);
        const body = processCBlock(block, target);
        return `while ${condition.toBool()}.not() (\n${body}wait 0.01\n)\n`;
      } case 'control_repeat': {
        const times = resolveInput(block.inputs.TIMES);
        const body = processCBlock(block, target);
        if (times instanceof ConstantInput && +times.toNum() <= 3) {
          if (times.value <= 0) return '';
          if (times.isConstant(1)) return body;
          if (body.split("\n").length < 5) {
            return `${body}defer\n`.repeat(times.value - 1);
          }
        }
        return `loop ${times.toNum()} (\n${body}defer\n)\n`;
      } case 'control_wait': {
        const time = resolveInput(block.inputs.DURATION).toNum();
        return `wait ${time}\n`;
      } case 'control_wait_until': {
        const condition = resolveBlock(blocks[block.inputs.CONDITION[1]], target);
        return `while ${condition}.toBool().not() (\ndefer\n)\n`;
      } case 'control_start_as_clone': {
        while (block.next) {
          block = blocks[block.next];
          source += resolveBlock(block, target);
        }
        return `void target.cloneStart.append({id: ouidNew(), code: def(target) -> (\n${source})})\n`;
      } case 'control_stop': {
        const stopType = block.fields.STOP_OPTION[0];
        if (stopType === 'all') {
          return `window.close()\n`;
        } else if (stopType === 'this script') {
          return `return ""\n`;
        } else if (stopType === 'other scripts in sprite') {
          return `void target.frame.map(v => threads[v.id].kill())\ntarget.frame = []\n`;
        }
        break;
      } case 'control_stopall': {
        return `window.close()\n`;
      } case 'control_create_clone_of': {
        const cloneOf = resolveInput(block.inputs.CLONE_OPTION).toUnknown();
        return `newCloneOf(${cloneOf})\n`;
      } case 'control_create_clone_of_menu': {
        if (block.fields.CLONE_OPTION[0] === '_myself_') return new TypedInput(`target`, TYPES.UNKNOWN);
        return new ConstantInput(block.fields.CLONE_OPTION[0], TYPES.STRING);
      } case 'procedures_definition': {
        const procedure = blocks[block.inputs.custom_block[1]]
        const mutation = procedure.mutation;
        const argsIds = JSON.parse(mutation.argumentids);
        const argNames = JSON.parse(mutation.argumentnames);
        const argObj = {};
        for (let i = 0; i < argsIds.length; i++) {
          argObj[argNames[i]] = {
            id: argsIds[i],
            index: i,
          }
        }
        file.argObj = argObj;
        while (block.next) {
          block = blocks[block.next];
          source += resolveBlock(block, target);
        }
        return `target.procedures["${procedure.mutation.proccode}"] = def(target, args) -> (\n${Object.values(argObj).map(v => `local arg${v.index} = args["${v.id}"]`).join("\n")}\n${source}\n)\n`;
      } case 'procedures_prototype': {
        return
      } case 'procedures_call': {
        const name = block.mutation.proccode;
        let argSrc = "{";
        for (const key in block.inputs) {
          const val = block.inputs[key];
          argSrc += `"${key}": ${resolveInput(val).toString()},`
        }
        argSrc += "}"
        return `target.procedures["${name}"](target, ${argSrc})\n`;
      } case 'argument_reporter_boolean':
          if (block.fields.VALUE[0] === 'is compiled?') return new TypedInput(`false`, TYPES.BOOLEAN);
        case 'argument_reporter_string_number': {
        const index = file.argObj[block.fields.VALUE[0]]?.index
        if (index === undefined) return new ConstantInput(0, TYPES.NUMBER);
        return new TypedInput(`arg${index}`, TYPES.UNKNOWN);
      } case 'event_whenbroadcastreceived': {
        let id = block.fields.BROADCAST_OPTION[0]

        while (block.next) {
          block = blocks[block.next];
          source += resolveBlock(block, target);
        }

        return `target.broadcasts["${id}"] ??= []\nvoid target.broadcasts["${id}"].append({id: ouidNew(), code: def(target) -> (\n${source})})\n`;
      } case 'looks_backdrops': {
        return new ConstantInput(block.fields.BACKDROP[0], TYPES.STRING);
      } case 'looks_say': {
        return `target.saying = ${resolveInput(block.inputs.MESSAGE)}\ntarget.saying_timeout = Infinity\n`;
      } case 'looks_sayforsecs': {
        const message = resolveInput(block.inputs.MESSAGE).toString();
        const seconds = resolveInput(block.inputs.SECS).toNum();
        return `target.saying = ${message}\ntarget.saying_timeout = timestamp + (${seconds} * 1000)\n`;
      } case 'looks_show': {
        return `target.shown = true\n`;
      } case 'looks_hide': {
        return `target.shown = false\n`;
      } case 'looks_gotofrontback': {
        if (block.fields.FRONT_BACK[0] === 'front') {
          return `void renderOrder.delete(renderOrder.index(target))\nvoid renderOrder.append(target)\n`;
        } else {
          return `void renderOrder.delete(renderOrder.index(target))\nvoid renderOrder.prepend(target)\n`;
        }
      } case 'looks_goforwardbackwardlayers': {
        const forward = block.fields.FORWARD_BACKWARD[0] === 'forward';
        const layer = resolveInput(block.inputs.NUM).toNum();
        return `// TODO: looks_goforwardbackwardlayers\n`;
      } case 'looks_setsizeto': {
        return `target.size = ${resolveInput(block.inputs.SIZE).toNum()}\n`;
      } case 'looks_changesizeby': {
        const change = resolveInput(block.inputs.CHANGE).toNum();
        return `target.size += ${change}\n`;
      } case 'looks_size': {
        return new TypedInput(`target.size`, TYPES.NUMBER);
      } case 'looks_costume': {
        return new ConstantInput(block.fields.COSTUME[0], TYPES.STRING);
      } case 'looks_nextcostume': {
        target.changesCostume = true
        return `target.currentCostume = (target.currentCostume + 1) % target.costumes.len\n`;
      } case 'looks_switchcostumeto': {
        target.changesCostume = true
        return 'target.currentCostume = target.costumes.getKeys("name").index(' + resolveInput(block.inputs.COSTUME).toString() + ')\n';
      } case 'looks_costumenumbername': {
        if (typeof block.fields.NUMBER_NAME === 'number') {
          return new TypedInput(`target.costumes[target.currentCostume].name`, TYPES.STRING);
        }
        return new TypedInput(`target.costumes[target.currentCostume].name`, TYPES.STRING);
      } case 'looks_backdropnumbername': {
        if (typeof block.fields.NUMBER_NAME === 'number') {
          return new TypedInput(`stage.currentCostume`, TYPES.STRING);
        }
        return new TypedInput(`stage.costumes[stage.currentCostume].name`, TYPES.STRING);
      } case 'looks_changeeffectby': {
        return `target.effects["${convertEffectForOSL(block.fields.EFFECT[0])}"] += ${resolveInput(block.inputs.CHANGE).toNum()}\n`;
      } case 'looks_seteffectto': {
        return `target.effects["${convertEffectForOSL(block.fields.EFFECT[0])}"] = ${resolveInput(block.inputs.VALUE).toNum()}\n`;
      } case 'looks_cleargraphiceffects': {
        return `target.effects = ${JSON.stringify(defaultEffect)}\n`;
      } case 'looks_switchbackdropto': {
        return 'stage.currentCostume = stage.costumes.getKeys("name").index(' + resolveInput(block.inputs.BACKDROP).toString() + ')\n';
      } case 'looks_nextbackdrop': {
        return 'stage.currentCostume = (stage.currentCostume + 1) % stage.costumes.len\n';
      } case 'sound_play': {
        const input = resolveInput(block.inputs.SOUND_MENU).toString()
        target.usesSounds = true
        return `sound target.sounds[${input}].md5ext "start"\n`;
      } case 'sound_playuntildone': {
        target.usesSounds = true
        return `sound target.sounds[${resolveInput(block.inputs.SOUND_MENU).toString()}].md5ext "play"\n`;
      } case 'sound_setvolumeto': {
        return `target.volume = ${resolveInput(block.inputs.VOLUME).toNum()}\n`;
      } case 'sound_seteffectto': {
        return `// sound effect would go here but its unsupported\n`;
      } case 'sound_sounds_menu': {
        return new ConstantInput(block.fields.SOUND_MENU[0], TYPES.STRING);
      } case 'sound_stopallsounds': {
        return `// stop all sounds would go here but its unsupported\n`;
      } case 'sound_volume': {
        return new TypedInput(`target.volume`, TYPES.NUMBER);
      } case 'sound_changevolumeby': {
        const change = resolveInput(block.inputs.VOLUME).toNum();
        return `target.volume += ${change}\n`;
      } case 'sensing_setdragmode': {
        return `target.draggable = ${block.fields.DRAG_MODE[0] === 'draggable'}\n`;
      } case 'sensing_timer': {
        return new TypedInput(`window_timer`, TYPES.NUMBER);
      } case 'sensing_resettimer': {
        return `start_timer = timer\n`;
      } case 'sensing_keypressed': {
        return new TypedInput(`${resolveInput(block.inputs.KEY_OPTION).toString()}.isKeyDown()`, TYPES.BOOLEAN);
      } case 'sensing_keyoptions': {
        return new TypedInput(`"${block.fields.KEY_OPTION[0]}"`, TYPES.STRING);
      } case 'sensing_mousex': {
        return new TypedInput(`mouse_x`, TYPES.NUMBER);
      } case 'sensing_mousey': {
        return new TypedInput(`mouse_y`, TYPES.NUMBER);
      } case 'sensing_mousedown': {
        return new TypedInput(`mouse_down`, TYPES.BOOLEAN);
      } case 'sensing_dayssince2000': {
        return new TypedInput(`(timestamp - 946684800000) / 86400000`, TYPES.NUMBER);
      } case 'sensing_online': {
        return new TypedInput(`network.online`, TYPES.BOOLEAN);
      } case 'sensing_of': {
        const object = resolveInput(block.inputs.OBJECT).toString()
        const property = block.fields.PROPERTY[0]
        if (object instanceof ConstantInput) {
          const isStage = object === '"_stage_"'

          // Note that if target isn't a stage, we can't assume it exists
          const objectReference = isStage ? 'stage' : `getTargetByName(${object})`
          if (property === 'volume') {
            return new TypedInput(`${objectReference}.volume`, TYPES.NUMBER);
          }
          if (isStage) {
            switch (property) {
              case 'background #':
              // fallthrough for scratch 1.0 compatibility
              case 'backdrop #':
                return new TypedInput(`${objectReference}.currentCostume`, TYPES.NUMBER);
              case 'backdrop name':
                return new TypedInput(`${objectReference}.costumes[${objectReference}.currentCostume].name`, TYPES.STRING);
            }
          } else {
            switch (property) {
              case 'x position':
                return new TypedInput(`${objectReference}.x`, TYPES.NUMBER);
              case 'y position':
                return new TypedInput(`${objectReference}.y`, TYPES.NUMBER);
              case 'direction':
                return new TypedInput(`${objectReference}.direction`, TYPES.NUMBER);
              case 'costume #':
                return new TypedInput(`${objectReference}.currentCostume`, TYPES.NUMBER);
              case 'costume name':
                return new TypedInput(`${objectReference}.costumes[${objectReference}.currentCostume].name`, TYPES.STRING);
              case 'size':
                return new TypedInput(`${objectReference}.size`, TYPES.NUMBER);
            }
          }
        }
        return new ConstantInput(0, TYPES.NUMBER);
      } case 'sensing_of_object_menu': {
        return new ConstantInput(block.fields.OBJECT[0], TYPES.STRING);
      } case 'sensing_distancetomenu': {
        return new ConstantInput(block.fields.DISTANCETOMENU[0], TYPES.STRING);
      } case 'sensing_distanceto': {
        const target = resolveInput(block.inputs.DISTANCETOMENU).toString();
        if (target === '_mouse_') {
          return new TypedInput(`dist(target.x * scale, target.y * scale, mouse_x, mouse_y)`, TYPES.NUMBER);
        }
        return new TypedInput(`dist(target.x, target.y, getTargetByName(${target}).x, getTargetByName(${target}).y)`, TYPES.NUMBER);
      } case 'sensing_touchingobject': {
        const target = resolveInput(block.inputs.TOUCHINGOBJECTMENU);
        if (target instanceof ConstantInput) {
          if (target.isConstant('_edge_')) return new TypedInput(`isTouchingEdge(target)`, TYPES.BOOLEAN);
          return new TypedInput(`isTouching(target, getTargetByName(${target.toString()}))`, TYPES.BOOLEAN);
        }
        return new TypedInput(`(${target} == "_edge_" ? isTouchingEdge(target) isTouching(target, getTargetByName(${target})))`, TYPES.BOOLEAN);
      } case 'sensing_touchingobjectmenu': {
        return new ConstantInput(block.fields.TOUCHINGOBJECTMENU[0], TYPES.STRING);
      } case 'sensing_touchingcolor': {
        return new ConstantInput("false", TYPES.BOOLEAN);
      } case 'sensing_askandwait': {
        const question = resolveInput(block.inputs.QUESTION);
        return `answerVar = (${question}).ask() ?? ""\n`;
      } case 'sensing_answer': {
        return new TypedInput(`answerVar`, TYPES.STRING);
      } case 'sensing_username': {
        return new TypedInput(`username`, TYPES.STRING);
      } case 'operator_mathop': {
        const operator = block.fields.OPERATOR[0];
        const input = resolveInput(block.inputs.NUM).toNum();
        switch (operator) {
          case 'abs': return new TypedInput(`abs(${input})`, TYPES.NUMBER);
          case 'floor': return new TypedInput(`floor(${input})`, TYPES.NUMBER);
          case 'ceiling': return new TypedInput(`ceil(${input})`, TYPES.NUMBER);
          case 'floor': return new TypedInput(`floor(${input})`, TYPES.NUMBER);
          case 'sqrt': return new TypedInput(`(${input}).sqrt()`, TYPES.NUMBER);
          case 'sin': return new TypedInput(`(${input}).sin()`, TYPES.NUMBER);
          case 'cos': return new TypedInput(`(${input}).cos()`, TYPES.NUMBER);
          case 'tan': return new TypedInput(`(${input}).tan()`, TYPES.NUMBER);
          case 'asin': return new TypedInput(`(${input}).asin()`, TYPES.NUMBER);
          case 'acos': return new TypedInput(`(${input}).acos()`, TYPES.NUMBER);
          case 'atan': return new TypedInput(`(${input}).atan()`, TYPES.NUMBER);
          default: return new TypedInput(`${operator}(${input})`, TYPES.NUMBER);
        }
      } case 'operator_random': {
        const min = resolveInput(block.inputs.FROM);
        const max = resolveInput(block.inputs.TO);
        return new TypedInput(`random(${min.toNum()}, ${max.toNum()})`, TYPES.NUMBER);
      } case 'operator_letter_of': {
        const string = resolveInput(block.inputs.STRING);
        const input = resolveInput(block.inputs.LETTER);
        return new TypedInput(`(${string.toString()}[${input.toNum()}])`, TYPES.STRING);
      } case 'operator_round': {
        const input = resolveInput(block.inputs.NUM);
        return new TypedInput(`round(${input.toNum()})`, TYPES.NUMBER);
      } case 'operator_equals': {
        const left = resolveInput(block.inputs.OPERAND1);
        const right = resolveInput(block.inputs.OPERAND2);
        return new TypedInput(`(${left.toString()} == ${right.toString()})`, TYPES.BOOLEAN);
      } case 'operator_gt': {
        const left = resolveInput(block.inputs.OPERAND1);
        const right = resolveInput(block.inputs.OPERAND2);
        return new TypedInput(`(${left.toNum()} > ${right.toNum()})`, TYPES.BOOLEAN);
      } case 'operator_lt': {
        const left = resolveInput(block.inputs.OPERAND1);
        const right = resolveInput(block.inputs.OPERAND2);
        return new TypedInput(`(${left.toNum()} < ${right.toNum()})`, TYPES.BOOLEAN);
      } case 'operator_add': {
        const left = resolveInput(block.inputs.NUM1) || new ConstantInput(0, TYPES.NUMBER);
        const right = resolveInput(block.inputs.NUM2) || new ConstantInput(0, TYPES.NUMBER);
        
        const folded = optimizer.foldBinaryOp('operator_add', left, right);
        if (folded) return folded;
        
        const simplified = optimizer.simplifyAdd(left, right);
        if (simplified) return simplified;
        return new TypedInput(`(${left.toNum()} + ${right.toNum()})`, TYPES.NUMBER);
      } case 'operator_subtract': {
        const left = resolveInput(block.inputs.NUM1) || new ConstantInput(0, TYPES.NUMBER);
        const right = resolveInput(block.inputs.NUM2) || new ConstantInput(0, TYPES.NUMBER);
        
        const folded = optimizer.foldBinaryOp('operator_subtract', left, right);
        if (folded) return folded;
        
        const simplified = optimizer.simplifySubtract(left, right);
        if (simplified) return simplified;
        return new TypedInput(`(${left.toNum()} - ${right.toNum()})`, TYPES.NUMBER);
      } case 'operator_multiply': {
        const left = resolveInput(block.inputs.NUM1) || new ConstantInput(0, TYPES.NUMBER);
        const right = resolveInput(block.inputs.NUM2) || new ConstantInput(0, TYPES.NUMBER);
        
        const folded = optimizer.foldBinaryOp('operator_multiply', left, right);
        if (folded) return folded;
        
        const simplified = optimizer.simplifyMultiply(left, right);
        if (simplified) return simplified;
        return new TypedInput(`(${left.toNum()} * ${right.toNum()})`, TYPES.NUMBER);
      } case 'operator_divide': {
        const left = resolveInput(block.inputs.NUM1) || new ConstantInput(0, TYPES.NUMBER);
        const right = resolveInput(block.inputs.NUM2) || new ConstantInput(0, TYPES.NUMBER);
        
        const folded = optimizer.foldBinaryOp('operator_divide', left, right);
        if (folded) return folded;
        
        const simplified = optimizer.simplifyDivide(left, right);
        if (simplified) return simplified;
        return new TypedInput(`(${left.toNum()} / ${right.toNum()})`, TYPES.NUMBER);
      } case 'operator_mod': {
        const left = resolveInput(block.inputs.NUM1) || new ConstantInput(0, TYPES.NUMBER);
        const right = resolveInput(block.inputs.NUM2) || new ConstantInput(0, TYPES.NUMBER);
        
        const folded = optimizer.foldBinaryOp('operator_mod', left, right);
        if (folded) return folded;
        
        const simplified = optimizer.simplifyDivide(left, right);
        if (simplified) return simplified;
        return new TypedInput(`(${left.toNum()} % ${right.toNum()})`, TYPES.NUMBER);
      } case 'operator_and': {
        const left = resolveInput(block.inputs.OPERAND1);
        const right = resolveInput(block.inputs.OPERAND2);
        return new TypedInput(`(${left.toBool()} and ${right.toBool()})`, TYPES.BOOLEAN);
      } case 'operator_or': {
        const left = resolveInput(block.inputs.OPERAND1);
        const right = resolveInput(block.inputs.OPERAND2);
        return new TypedInput(`(${left.toBool()} or ${right.toBool()})`, TYPES.BOOLEAN);
      } case 'operator_not': {
        const input = resolveInput(block.inputs.OPERAND);
        return new TypedInput(`(${input.toBool()}).not()`, TYPES.BOOLEAN);
      } case 'operator_join': {
        const left = resolveInput(block.inputs.STRING1);
        const right = resolveInput(block.inputs.STRING2);
        return new TypedInput(`(${left.toString()} ++ ${right.toString()})`, TYPES.STRING);
      } case 'operator_length': {
        const input = resolveInput(block.inputs.STRING);
        return new TypedInput(`${input.toString()}.len`, TYPES.NUMBER);
      } case 'operator_contains': {
        const string = resolveInput(block.inputs.STRING1);
        const substring = resolveInput(block.inputs.STRING2);
        return new TypedInput(`${string.toString()}.contains(${substring.toString()})`, TYPES.BOOLEAN);
      } case 'pen_setPenColorToColor': {
        const color = resolveInput(block.inputs.COLOR).toString();
        return `target.pen.color = ${color}\n`;
      } case 'pen_setPenSizeTo': {
        const size = resolveInput(block.inputs.SIZE).toNum();
        return `target.pen.size = ${size}\n`;
      } case 'pen_penDown': {
        return `if target.pen.down == false (\ntarget.pen.points.append({x: target.x, y: target.y, size: target.pen.size, color: target.pen.color, type: "start"})\ntarget.pen.down = true\n)\n`;
      } case 'pen_penUp': {
        return `target.pen.down = false\n`;
      } case 'pen_clear': {
        return `penIcon = []\ntarget.pen.points = []\n`;
      } case 'pen_setPenColorParamTo': {
        const param = block.inputs.COLOR_PARAM[0];
        const paramName = ['', 'transparency'][param];
        const color = resolveInput(block.inputs.VALUE).toString();
        return `target.pen.params["${paramName}"] = ${color}\n`;
      } case 'pen_stamp': {
        return ""
      } default:
        return new TypedInput(`/* Unhandled block: ${block.opcode} */`, TYPES.UNKNOWN);
    }
  } catch (error) {
    console.error(`Error processing block ${block.opcode}:`, error);
    return `/* Error in block ${block.opcode}: ${error.message} */`;
  }
}

function compileOSL(file) {
  globalThis.file = file;
  let source = `window.show()
window.setResizable(false)
window.framerate = 30

window_colour = #ffffff
monitor_colour = #f1913b
monitor_bg = #e7f0ff
monitor_outline = #c3cdd7
monitor_text = #595f75
monitor_text_value = #ffffff

answerVar = ""
targets = []
threads = {}
window_timer = 0
start_timer = timer
renderOrder = (1 to ${file.targets.length}).fill(null)
targetNameCache = {}
answer = ""

scale = 1.3
window.resize(480 * scale, 400 * scale)

penIcon = []

def runThread(object func, object data, boolean kill) (
  local cur_thread @= threads[func.id]
  if kill and cur_thread.alive == true (
    cur_thread.kill()
    cur_thread.alive = false
  )
  if cur_thread.alive !== true (
    threads[func.id] @= worker({
      target: data,
      func: func.code,
      isThread: true,
      oncreate: def() -> (
        self.func(self.target)
        self.kill()
      ),
    })
  )
)
  
def broadcast(string id) (
  for i targets.len (
    local target @= targets[i]
    if target.broadcasts[id] != null (
      for j target.broadcasts[id].len (
        local f @= target.broadcasts[id][j]
        runThread(f, target, true)
      )
    )
  )
)

def broadcastAndWait(string id) (
  local workers = []
  for i targets.len (
    local target @= targets[i]
    if target.broadcasts[id] != null (
      for j target.broadcasts[id].len (
        local f @= target.broadcasts[id][j]
        void workers.append(runThread(f, target, true))
      )
    )
  )
  number aliveNum = workers.len
  while aliveNum > 0 (
    aliveNum = 0
    for i workers.len (
      if workers[i].alive (
        aliveNum ++
      )
    )
    defer
  )
)

def setMonitorVisible(string? spriteName, string varName, boolean visible) (
  for i monitors.len (
    local monitor @= monitors[i]
    if monitor.params.VARIABLE == varName and monitor.spriteName == spriteName (
      monitor.visible = visible
    )
  )
)

def isTouchingEdge(object target) (
  object costume = target.costumes[target.currentCostume]

  myId = costume.md5ext
  myWidth = myId.imageinfo("width").toNum()
  myHeight = myId.imageinfo("height").toNum()

  number myHalfW = myWidth / 2 * scale
  number myHalfH = myHeight / 2 * scale
  if target.x - myHalfW < 0 and target.x + myHalfW > 0 and target.y - myHalfH < 0 and target.y + myHalfH > 0 (
    return true
  )
  return false
)

def isTouching(object target, object other) (
  object otherCostume = other.costumes[other.currentCostume]
  object costume = target.costumes[target.currentCostume]

  myId = costume.md5ext
  myWidth = myId.imageinfo("width").toNum()
  myHeight = myId.imageinfo("height").toNum()

  otherId = otherCostume.md5ext
  otherWidth = otherId.imageinfo("width").toNum()
  otherHeight = otherId.imageinfo("height").toNum()

  number myHalfW = myWidth / 2 * scale
  number myHalfH = myHeight / 2 * scale
  number otherHalfW = otherWidth / 2 * scale
  number otherHalfH = otherHeight / 2 * scale

  if target.x - myHalfW < other.x + otherHalfW and target.x + myHalfW > other.x - otherHalfW and target.y - myHalfH < other.y + otherHalfH and target.y + myHalfH > other.y - otherHalfH (
    return true
  )
  return false
)

def getTargetByName(string name) (
  if name in targetNameCache (
    return targetNameCache[name]
  )
  for i targets.len (
    local target @= targets[i]
    if target.name == name (
      targetNameCache[name] @= target
      return target
    )
  )
  throw "error" "Target not found: " ++ name
)

def click(object target) (
  for i target.onclick.len (
    runThread(target.onclick[i], target, true)
  )
)

def keyPressed(array keys) (
  for i targets.len (
    local target @= targets[i]
    for j keys.len (
      local key = keys[j]
      local keyPressed = target.keyPressed[key]
      if keyPressed != null (
        for k keyPressed.len (
          runThread(keyPressed[k], target, true)
        )
      )
    )
    if keys.len > 0 and target.keyPressed["any"] != null (
      for j target.keyPressed["any"].len (
        local f @= target.keyPressed["any"][j]
        runThread(f, target, true)
      )
    )
  )
)

def ifOnEdgeBounce(object target) (
  boolean bounced = false

  if target.x < 0 (
    target.x = 0
    target.direction = 180 - target.direction
    bounced = true
  ) else if target.x > 480 (
    target.x = 480
    target.direction = 180 - target.direction
    bounced = true
  )

  if target.y < 0 (
    target.y = 0
    target.direction = 360 - target.direction
    bounced = true
  ) else if target.y > 360 (
    target.y = 360
    target.direction = 360 - target.direction
    bounced = true
  )

  if bounced (
    target.direction = target.direction % 360
    if target.direction < 0 (
      target.direction += 360
    )
  )
)

def greenflag() (
  for i targets.len (
    local target @= targets[i]
    for j target.greenflag.len (
      runThread(target.greenflag[j], target, true)
    )
  )
)

def renderMonitors() (
  local h = 20 * scale

  for i monitors.len (
    monitor @= monitors[i]
    if monitor.visible (
      loc 2 2 monitor.x * scale monitor.y + 50 * scale * -1
      direction 90
      if monitor.spriteName == null and monitor.opcode == "data_variable" (
        monitor.value = stage.variables[monitor.params.VARIABLE]
      )
      switch monitor.mode (
        case "large"
          local txt = monitor.value
          local w = txt.len * 10 * scale
          h -= 2
          change_x w / 2
          square w h 8 * scale : c#monitor_outline
          square w h 7 : c#monitor_colour

          centext txt 10 * scale : c#monitor_text_value
          break
        default
          local txt = monitor.params.VARIABLE.len + monitor.value.len

          local w = txt + 0.5 * 10 * scale
          local x = x_position
          change_x w / 2 -10 * scale
          square w h 13 * scale : c#monitor_outline
          square w h 9 * scale : c#monitor_bg
          local w2 = monitor.value.len + 1 * 10 * scale
          change_x w / 2 - (w2 / 2)
          square w2 h 6 : c#monitor_colour

          set_x x
          text monitor.params.VARIABLE 10 * scale : c#monitor_text
          text monitor.value 10 * scale : c#monitor_text_value
      )
    )
  )
)

def cloneFuncArr(array funcs) (
  for i funcs.len (
    funcs[i].id = ouidNew()
  )
  return funcs
)

def cloneFuncObj(object funcs) (
  array keys = funcs.getKeys()
  for i keys.len (
    funcs[keys[i]].id = ouidNew()
  )
  return funcs
)

def cloneBroadcasts(object broadcasts) (
  object out = broadcasts
  array keys @= out.getKeys()
  for i keys.len (
    array cur @= out[keys[i]]
    for j cur.len (
      cur[j].id = ouidNew()
    )
  )
  return out
)

cloneCount = 0

def newCloneOf(object target) (
  if cloneCount > 300 (
    return
  )
  cloneCount ++
  local newTarget @= {
    isOriginal: false,
    broadcasts: cloneBroadcasts(target.broadcasts),
    greenflag: [],
    onclick: cloneFuncArr(target.onclick),
    keyPressed: cloneFuncObj(target.keyPressed),
    frame: [],
    cloneStart: cloneFuncArr(target.cloneStart),
    x: target.x,
    y: target.y,
    direction: target.direction,
    size: target.size,
    costumes: target.costumes,
    sounds: target.sounds,
    shown: target.shown,
    currentCostume: target.currentCostume,
    rotationStyle: target.rotationStyle ?? "all around",
    variables: target.variables,
    lists: target.lists.clone(),
    procedures: target.procedures,
    draggable: target.draggable,
    pen: target.pen.clone(),
    effects: target.effects.clone(),
    goto: target.goto,
    gotoXY: target.gotoXY,
    moveSteps: target.moveSteps,
  }
  for i newTarget.cloneStart.len (
    local f @= newTarget.cloneStart[i]
    runThread(f, newTarget, false)
  )
  void targets.append(newTarget)
  void renderOrder.insert(renderOrder.index(target), newTarget)
)

def moveSteps(number steps) (
  number x = self.x + (self.direction.sin() * steps)
  number y = self.y + (self.direction.cos() * steps)
  self.gotoXY(x, y)
)

def gotoTarget(object target) (
  self.gotoXY(target.x, target.y)
)

def gotoXY(number x, number y) (
  if self.pen.down (
    self.pen.points.append({x, y, size: self.pen.size, color: self.pen.color, type: "cont"})
  )
  self.x = x
  self.y = y
)

def renderFrame() (
  for i targets.len (
    local target @= targets[i]
    for j target.frame.len (
      f @= target.frame[j]
      runThread(f, target, false)
    )
  )
  local h = 20 * scale

  // handle stage
  local costume = stage.costumes[stage.currentCostume]
  local url = costume.md5ext
  number width = url.imageinfo("width").toNum()
  number height = url.imageinfo("height").toNum()
  goto 0 -20 * scale
  switch costume.dataFormat (
    case "png"
      change costume.rotationCenterX * -scale costume.rotationCenterY * -scale
      change width * scale height * scale
      break
  )
  direction 90
  stretch [100, 100]
  effect "clear"
  image url stage.size * 4.80 * width / 480 * scale

  icon penIcon.join(" ") 1 : c#000

  // handle targets
  for i renderOrder.len (
    local target @= renderOrder[i]
    local last @= target.pen.points[1]
    for j target.pen.points.len (
      local cur @= target.pen.points[j]
      if cur.size != last.size (
        void penIcon.append("w", cur.size)
        last.size = cur.size
      )
      if cur.color != last.color (
        void penIcon.append("c", cur.color)
        last.color = cur.color
      )
      switch cur.type (
        case "start"
          last @= cur
          void penIcon.append("line", cur.x, cur.y, cur.x, cur.y)
          break
        case "cont"
          void penIcon.append("cont", cur.x, cur.y)
          last @= cur
          break
      )
    )
    if target.shown (
      if target.touching_mouse and mouse_ondown (
        click(target)
      )
      keyPressed(all_hit)
      goto target.x * scale target.y - 20 * scale
      stretch "x" 100
      switch target.rotationStyle (
        case "left-right"
          stretch "x" target.direction > 0 ? 100 -100
          direction 90
          break
        case "dont-rotate"
          direction 90
          break
        default
          direction target.direction
          break
      )
      local costume = target.costumes[target.currentCostume]
      local url = costume.md5ext
      number width = url.imageinfo("width").toNum()
      number height = url.imageinfo("height").toNum()
      switch costume.dataFormat (
        case "png"
          change costume.rotationCenterX * -scale costume.rotationCenterY * -scale
          change width * scale height * scale
          break
      )
      effect "clear"
      array effects @= target.effects.getKeys()
      for j effects.len (
        effect effects[j] target.effects[effects[j]]
      )
      image url target.size * 4.80 * width / 480 * scale
      target.touching_mouse = mouse_touching

      if target.saying != null (
        local txt = target.saying
        change_y height / 2 * scale
        set_x x_position.clamp(window.left + (txt.len * 5), window.right - (txt.len * 5))
        set_y y_position.clamp(window.bottom + 20, window.top - 70)
        square txt.len * 10 * scale h 10 : c#bbb
        centext txt 10 * scale : c#000
        if target.saying_timeout < timestamp (
          target.saying = null
        )
      )
    )
  )
  renderMonitors()
  goto 0 window.top - (20 * scale)
  square window.width 40 * scale : c#aaa
  set_x window.left + (20 * scale)
  icon "c #a22 line -4 10 4 10 cont 10 4 cont 10 -4 cont 4 -10 cont -4 -10 cont -10 -4 cont -10 4 cont -4 10 scale 0.9 c #f55 line -4 10 4 10 cont 10 4 cont 10 -4 cont 4 -10 cont -4 -10 cont -10 -4 cont -10 4 cont -4 10 w 20 dot 0 0" 0.7 * scale
  if onclick (
    window.close()
  )
  text "${file.name}" 10 * scale : c#000 chx#(20 * scale)

  text "Clones: " ++ cloneCount 10 * scale : chx#(20 * scale)
  goto 0 0
)\n\n`;

  const headerSource = source
  source = ""
  for (let i = 0; i < file.targets.length; i++) {
    const target = file.targets[i];
    current_target = i + 1
    target.num = i + 1;
    source += `\n// target ${i + 1}\ntarget @= targets[${i + 1}]\n`;
    for (let k = 0; k < Object.keys(target.blocks).length; k++) {
      const id = Object.keys(target.blocks)[k];
      const block = target.blocks[id];
      block.id = id
      blocks = target.blocks;
      if (block.topLevel && block.next !== null && block.shadow === false) {
        source += resolveBlock(block, target);
      }
    }
  }

  const blockSource = source
  source = ""
  for (let i = 0; i < file.targets.length; i++) {
    const target = file.targets[i]
    let vars = {};
    for (const key in target.variables) {
      const val = target.variables[key];
      vars[val[0]] = val[1];
    }

    let lists = {};
    for (const key in target.lists) {
      const val = target.lists[key];
      lists[val[0]] = val[1];
    }

    let broadcasts = {};
    for (const name of Object.values(target.broadcasts)) {
      broadcasts[name] = [];
    }

    let sounds = {};
    for (const key in target.sounds) {
      sounds[target.sounds[key].name] = target.sounds[key];
    }

    let costumes = target.costumes.map((v, i) => { v.id = i + ":" + v.name; return v }) ?? []
    if (target.changesCostume !== true) {
      costumes = [target.costumes[target.currentCostume]]
      target.currentCostume = 0;
    }

    source += `void targets.append({
  name: "${target.name}",
  isOriginal: true,
  greenflag: [],
  broadcasts: ${JSON.stringify(broadcasts, null, 2)},
  onclick: [],
  keyPressed: {},
  frame: [],
  cloneStart: [],
  x: ${target.x ?? 0},
  y: ${target.y ?? 0},
  direction: ${target.direction ?? 90},
  rotationStyle: "${target.rotationStyle ?? "all around"}",
  size: ${target.size ?? 100},
  costumes: ${JSON.stringify(costumes)},
  sounds: ${target.usesSounds && false ? JSON.stringify(sounds) : '{}'},
  variables: ${JSON.stringify(vars)},
  lists: ${JSON.stringify(lists)},
  shown: ${target.visible ?? true},
  currentCostume: ${(target.currentCostume ?? 0) + 1},
  procedures: {},
  pen: {down: false, points: [], size: 1, color: "#000000"},
  effects: ${JSON.stringify(defaultEffect)},
  goto: gotoTarget,
  gotoXY: gotoXY,
  moveSteps: moveSteps,
})
renderOrder[${target.layerOrder + 1}] @= targets[-1]\n`;
  }

  source += `

stage @= targets[1]
renderOrder.delete(renderOrder.index(stage))

monitors = ${JSON.stringify(file.monitors, null, 2)}

// Load Costumes
each target targets (
  each costume target.costumes (
    image "load" costume.data costume.md5ext
  )
)
// Load Sounds
each target targets (
  each sound target.sounds (
    sound sound.data "load" sound.md5ext
  )
)\n`
  const targetSource = source

  source = headerSource + targetSource + blockSource

  source += `\n\ngreenflag()\nmainloop:\nrenderFrame()\nwindow_timer = timer - start_timer`;

  typeTracker.printStats();

  fs.writeFileSync(path.join(__dirname, 'compiled.osl'), source);
  console.log('Compiled OSL file created successfully.');
  return file;
}

const project = expandSb3File("Little Square.sb3",{
  assetOptimization: true,
  extractAssets: true
});

// const project = expandSb3File("fixed.sb3");

// const project = expandSb3File("Mowing Simulator.sb3");

compileOSL(project);