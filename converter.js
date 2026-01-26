const fs = require('fs');
const path = require('path');
const JSZip = require('node-zip');

const defaultEffect = {transparency: 0, colour: 0, brightness: 100, fisheye: 0, pixelate: 0}

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

function forceType(value, type) {
  if (value === null || value === undefined) {
    if (type === 'number') return "0";
    if (type === 'string') return '""';
    if (type === 'boolean') return "false";
    return value;
  }
  
  value = "" + value;
  if (type === 'number') {
    if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1);
    return `${value}.toNum()`;
  } else if (type === 'string') {
    if (value.startsWith('"') && value.endsWith('"')) return value;
    return `${value}.toStr()`;
  } else if (type === 'boolean') {
    return `${value}.toBool()`;
  }
  return value;
}

function resolveInput(input) {
  if (!input) {
    return 0;
  }
  
  if (!Array.isArray(input)) {
    if (typeof input === 'number') return input;
    if (typeof input === 'string') return `"${escapeString(input)}"`;
    return input || 0;
  }
  
  if (input.length === 0) return 0;
  
  switch (input[0]) {
    case 1:  // Block reference or direct value
      if (Array.isArray(input[1])) {
        // Handle direct values with proper type conversion
        const value = input[1][1];
        if (typeof value === 'number') return value;
        if (typeof value === 'string') return `"${escapeString(value)}"`;
        return value || 0;
      } else {
        // Handle block reference with caching for performance
        if (!blocks[input[1]]) {
          console.warn(`Block reference ${input[1]} not found in target ${current_target}`);
          return 0; 
        }
        // Check for circular references to avoid infinite recursion
        if (blockProcessingStack.includes(input[1])) {
          console.warn(`Circular reference detected for block ${input[1]}`);
          return 0;
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
        return 0; 
      }
      // Check for circular references
      if (blockProcessingStack.includes(input[1])) {
        console.warn(`Circular reference detected for block ${input[1]}`);
        return 0;
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
          return `"${escapeString(input[1][1] || "")}"`;
        }
        if (input[1][0] === 4 || input[1][0] === 5) {
          const num = Number(input[1][1]);
          return isNaN(num) ? 0 : num;
        }
        // Handle other nested reporter types
        return resolveInput(input[1]);
      }
      
      // Better error handling for missing blocks
      if (!blocks[input[1]]) {
        console.warn(`Reporter block ${input[1]} not found in target ${current_target}`);
        return 0;
      }
      
      // Check for circular references
      if (blockProcessingStack.includes(input[1])) {
        console.warn(`Circular reference detected for block ${input[1]}`);
        return 0;
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
      
      return numValue;
      
    case 9:  // Color input
      // Ensure color has proper format with full validation
      if (!input[1]) return '#000000';
      
      // Check if already has # prefix
      const colorStr = input[1].toString();
      if (colorStr.startsWith('#')) return colorStr;
      
      // Verify it's a valid hex color and normalize to 6 digits
      const isValidHex = /^[0-9A-Fa-f]{3,8}$/.test(colorStr);
      if (!isValidHex) return '#000000';
      
      return `#${colorStr}`;
      
    case 10:  // String input
      // Comprehensive string escaping for all potential issues
      return `"${escapeString(input[1] || "")}"`;
      
    case 11:  // Broadcast input
      // Full broadcast name validation and normalization
      if (!input[1]) return '""';
      
      // If it's already a reference to a broadcast ID, process it
      if (Array.isArray(input[1]) && input[1][0] === 11) {
        return `"${escapeString(input[1][1] || "")}"`;
      }
      
      return `"${escapeString(input[1].toString())}"`;
      
    case 12: { // Variable reference
      // Store the variable name for later reference
      variable_names[input[2]] = input[1];

      // Add safety check for variable target existence
      const variableTarget = globalThis.file.targets.filter(v => v.variables && v.variables[input[2]])[0];
      if (!variableTarget) {
        console.warn(`Variable target for ${input[1]} (${input[2]}) not found`);
        return '""'; // Return empty string as fallback
      }
      
      return `targets[${variableTarget.num}].variables["${input[1]}"]`;
    }
    
    case 13: { // List reference
      // Add safety check for list target existence
      const listTarget = globalThis.file.targets.filter(v => v.lists && v.lists[input[2]])[0];
      if (!listTarget) {
        // Check if it might be in variables instead (Scratch sometimes puts lists in variables)
        const varTarget = globalThis.file.targets.filter(v => v.variables && v.variables[input[2]])[0];
        if (varTarget) {
          return `targets[${varTarget.num}].variables["${input[1]}"]`;
        }
        console.warn(`List target for ${input[1]} (${input[2]}) not found`);
        return '[]'; // Return empty array as fallback
      }
      
      return `targets[${listTarget.num}].variables["${input[1]}"]`;
    }

    default:
      // Special case for arrays we don't recognize
      if (Array.isArray(input)) {
        console.warn(`Unknown input type: ${input[0]}`);
        // Try to extract something useful
        if (input.length > 1) {
          if (typeof input[1] === 'number') return input[1];
          if (typeof input[1] === 'string') return `"${input[1].replace(/"/g, '\\"')}"`;
          if (Array.isArray(input[1])) return resolveInput(input[1]);
        }
      }
      
      // For numbers or strings, return them directly with proper typing
      if (typeof input === 'number') return input;
      if (typeof input === 'string') return `"${input.replace(/"/g, '\\"')}"`;
      
      // Default fallback value based on context
      console.warn(`Unhandled input type, using default value`);
      return 0; // safer default for math operations
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
  const num = globalThis.file.targets.filter(v => v.variables[variableId])[0].num;

  if (num === current_target) return "target";
  if (num === 1) return "stage";

  return `targets[${num}]`;
}

function getTargetForList(listId, current_target) {
  const num = globalThis.file.targets.filter(v => v.lists[listId])[0].num;

  if (num === current_target) return "target";
  if (num === 1) return "stage";

  return `targets[${num}]`;
}

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
        if (target === '"_mouse_"') {
          return `target.gotoXY(mouse_x, mouse_y)\n`;
        } else if (target === '"_random_"') {
          return `target.gotoXY(random(-240, 240), random(-180, 180))\n`;
        }

        return `target.goto(getTargetByName(${target}))\n`;
      } case 'motion_goto_menu': {
        return `"${block.fields.TO[0]}"`
      } case 'motion_gotoxy': {
        return `target.gotoXY(${forceType(resolveInput(block.inputs.X), 'number')}, ${forceType(resolveInput(block.inputs.Y), 'number')})\n`;
      } case 'motion_ifonedgebounce': {
        return `ifOnEdgeBounce(target)\n`;
      } case 'motion_movesteps': {
        const steps = forceType(resolveInput(block.inputs.STEPS), 'number');
        if (steps === 0) return '';
        return `target.gotoXY(target.x + target.direction.sin() * ${steps}, target.y + target.direction.cos() * ${steps})\n`;
      } case 'motion_turnright': {
        const degrees = forceType(resolveInput(block.inputs.DEGREES), 'number');
        if (degrees === 0) return '';
        return `target.direction += ${degrees}\n`;
      } case 'motion_turnleft': {
        const degrees = forceType(resolveInput(block.inputs.DEGREES), 'number');
        if (degrees === 0) return '';
        return `target.direction -= ${degrees}\n`;
      } case 'motion_setrotationstyle': {
        return `target.rotationStyle = "${block.fields.STYLE[0]}"\n`;
      } case 'motion_setx': {
        return `target.gotoXY(${resolveInput(block.inputs.X)}, target.y)\n`;
      } case 'motion_sety': {
        return `target.gotoXY(target.x, ${resolveInput(block.inputs.Y)})\n`;
      } case 'motion_changexby': {
        const changeX = forceType(resolveInput(block.inputs.DX), 'number');
        return `target.gotoXY(target.x + ${changeX}, target.y)\n`;
      } case 'motion_changeyby': {
        const changeY = forceType(resolveInput(block.inputs.DY), 'number');
        return `target.gotoXY(target.x, target.y + ${changeY})\n`;
      } case 'motion_pointindirection': {
        const direction = forceType(resolveInput(block.inputs.DIRECTION), 'number');
        return `target.direction = ${direction}\n`;
      } case 'motion_pointtowards': {
        const target = resolveInput(block.inputs.TOWARDS);
        if (target === '_mouse_') {
          return `pointat mouse_x mouse_y\ntarget.direction = direction\n`;
        } else {
          return `pointat getTargetByName(${target}).X getTargetByName(${target}).Y\ntarget.direction = direction\n`;
        }
      } case 'motion_pointtowards_menu': {
        return `"${block.fields.TOWARDS[0]}"`
      } case 'motion_direction': {
        return `target.direction`;
      } case 'motion_xposition': {
        return `target.x`;
      } case 'motion_yposition': {
        return `target.y`;
      } case 'data_setvariableto': {
        const variableName = block.fields.VARIABLE[0];
        const variableId = block.fields.VARIABLE[1];
        variable_names[variableId] = variableName;
        
        const value = resolveInput(block.inputs.VALUE);
        const targetStr = getTargetForVariable(variableId, current_target);

        return `${targetStr}.variables["${variableName}"] = ${value}\n`;
      } case 'data_changevariableby': {
        const variableName = block.fields.VARIABLE[0];
        const variableId = block.fields.VARIABLE[1];
        variable_names[variableId] = variableName;
        
        const value = forceType(resolveInput(block.inputs.VALUE), 'number');
        const targetStr = getTargetForVariable(variableId, current_target);
        
        return `${targetStr}.variables["${variableName}"] += ${value}\n`;
      } case 'data_showvariable': {
        const variableName = block.fields.VARIABLE[0];
        const variableId = block.fields.VARIABLE[1];

        const targetStr = getTargetForVariable(variableId, current_target);
        return `${targetStr}.variables["${variableName}"].shown = true\n`;
      } case 'data_hidevariable': {
        const variableName = block.fields.VARIABLE[0];
        const variableId = block.fields.VARIABLE[1];

        const targetStr = getTargetForVariable(variableId, current_target);
        return `${targetStr}.variables["${variableName}"].shown = false\n`;
      } case 'data_lengthoflist': {
        const listName = block.fields.LIST[0];
        const listId = block.fields.LIST[1];
        list_names[listId] = listName;
        
        const targetStr = getTargetForList(listId, current_target);

        return `${targetStr}.lists["${listName}"].len`;
      } case 'data_itemoflist': {
        const listName = block.fields.LIST[0];
        const listId = block.fields.LIST[1];
        list_names[listId] = listName;
        
        const index = resolveInput(block.inputs.INDEX);
        const targetStr = getTargetForList(listId, current_target);

        return `${targetStr}.lists["${listName}"][${index}]`;
      } case 'data_deleteoflist': {
        const listName = block.fields.LIST[0];
        const listId = block.fields.LIST[1];
        list_names[listId] = listName

        
      } case 'data_addtolist': {
        const listName = block.fields.LIST[0];
        const listId = block.fields.LIST[1];
        list_names[listId] = listName;
        
        const item = resolveInput(block.inputs.ITEM);
        const targetStr = getTargetForList(listId, current_target);

        return `void ${targetStr}.lists["${listName}"].append(${item})\n`;
      } case 'data_itemoflist': {
        const listName = block.fields.LIST[0];
        const listId = block.fields.LIST[1];
        list_names[listId] = listName;
        
        const index = resolveInput(block.inputs.INDEX);
        const targetStr = getTargetForList(listId, current_target);

        return `${targetStr}.lists["${listName}"][${index}]`;
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

        return `${targetStr}.lists["${listName}"].contains(${item})`;
      } case 'data_replaceitemoflist': {
        const listName = block.fields.LIST[0];
        const listId = block.fields.LIST[1];
        list_names[listId] = listName;
        
        const index = resolveInput(block.inputs.INDEX);
        const item = resolveInput(block.inputs.ITEM);
        const targetStr = getTargetForList(listId, current_target);

        return `${targetStr}.lists["${listName}"][${index}] = ${item}\n`;
      } case 'data_insertitemoflist': {
        const listName = block.fields.LIST[0];
        const listId = block.fields.LIST[1];
        list_names[listId] = listName;
        
        const index = resolveInput(block.inputs.INDEX);
        const item = resolveInput(block.inputs.ITEM);
        const targetStr = getTargetForList(listId, current_target);

        return `void ${targetStr}.lists["${listName}"].insert(${index}, ${item})\n`;
      } case 'data_showlist': {
        const listName = block.fields.LIST[0];
        const listId = block.fields.LIST[1];
        list_names[listId] = listName;
        
        const targetStr = getTargetForList(listId, current_target);
        return `${targetStr}.lists["${listName}"].shown = true\n`;
      } case 'data_hidelist': {
        const listName = block.fields.LIST[0];
        const listId = block.fields.LIST[1];
        list_names[listId] = listName;
        
        const targetStr = getTargetForList(listId, current_target);
        return `${targetStr}.lists["${listName}"].shown = false\n`;
      } case 'data_itemnumoflist': {
        const listName = block.fields.LIST[0];
        const listId = block.fields.LIST[1];
        list_names[listId] = listName;
        
        const targetStr = getTargetForList(listId, current_target);

        return `${targetStr}.lists["${listName}"].index(${resolveInput(block.inputs.ITEM)})`;
      } case 'control_forever': {
        const body = processCBlock(block, target);
        return `void target.frame.append({id: ouidNew(), code: def(target) -> (\n${body})})\n`;
      } case 'control_if': {
        const condition = resolveBlock(blocks[block.inputs.CONDITION[1]], target);
        const body = processCBlock(block, target);
        return `if ${condition} (\n${body})\n`;
      } case 'control_if_else': {
        const condition = resolveBlock(blocks[block.inputs.CONDITION[1]], target);
        const ifBranch = processCBlock(block, target);
        const elseBranch = processCBlock(block, target, 'SUBSTACK2');
        return `if ${condition} (\n${ifBranch}) else (\n${elseBranch})\n`;
      } case 'control_delete_this_clone': {
        return `void targets.delete(targets.index(target))\nvoid renderOrder.delete(renderOrder.index(target))\n`;
      } case 'event_whenthisspriteclicked': {
        while (block.next) {
          const next = block.next;
          block.next = null;
          block = blocks[next];
          source += resolveBlock(block, target);
        }
        return `void target.onclick.append({id: ouidNew(), code: def(target) -> (\n${source})}\n)\n`;
      } case 'event_broadcast': {
        const message = resolveInput(block.inputs.BROADCAST_INPUT)
        return `broadcast(${message})\n`;
      } case 'event_broadcastandwait': {
        const message = resolveInput(block.inputs.BROADCAST_INPUT)
        return `broadcastAndWait(${message})\n`;
      } case 'control_repeat_until': {
        const condition = resolveBlock(blocks[block.inputs.CONDITION[1]], target);
        const body = processCBlock(block, target);
        return `while ${condition}.toBool().not() (\n${body}wait 0.01\n)\n`;
      } case 'control_repeat': {
        const times = forceType(resolveInput(block.inputs.TIMES), 'number');
        const body = processCBlock(block, target);
        return `loop ${times} (\n${body}defer\n)\n`;
      } case 'control_wait': {
        const time = resolveInput(block.inputs.DURATION);
        return `wait ${forceType(time, 'number')}\n`;
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
        const cloneOf = resolveInput(block.inputs.CLONE_OPTION);
        return `newCloneOf(${cloneOf})\n`;
      } case 'control_create_clone_of_menu': {
        if (block.fields.CLONE_OPTION[0] === '_myself_') return 'target';
        return block.fields.CLONE_OPTION[0]
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
          argSrc += `"${key}": ${resolveInput(val)},`
        }
        argSrc += "}"
        return `target.procedures["${name}"](target, ${argSrc})\n`;
      } case 'argument_reporter_string_number': {
        return `arg${file.argObj[block.fields.VALUE[0]].index}`
      } case 'event_whenbroadcastreceived': {
        let id = block.fields.BROADCAST_OPTION[0]

        while (block.next) {
          block = blocks[block.next];
          source += resolveBlock(block, target);
        }

        return `target.broadcasts["${id}"] ??= []\nvoid target.broadcasts["${id}"].append(def(target) -> (\n${source}))\n`;
      } case 'looks_backdrops': {
        return `"${block.fields.BACKDROP[0]}"`
      } case 'looks_say': {
        return `target.saying = ${resolveInput(block.inputs.MESSAGE)}\ntarget.saying_timeout = Infinity\n`;
      } case 'looks_sayforsecs': {
        const message = resolveInput(block.inputs.MESSAGE);
        const seconds = forceType(resolveInput(block.inputs.SECS), 'number');
        return `target.saying = ${message}\ntarget.saying_timeout = timestamp + (${seconds} * 1000)\n`;
      } case 'looks_show': {
        return `target.shown = true\n`;
      } case 'looks_hide': {
        return `target.shown = false\n`;
      } case 'looks_gotofrontback': {
        if (block.fields.FRONT_BACK[0] === 'front') {
          return `void renderOrder.delete(target)\nvoid renderOrder.append(target)\n`;
        } else {
          return `void renderOrder.delete(target)\nvoid renderOrder.prepend(target)\n`;
        }
      } case 'looks_setsizeto': {
        return `target.size = ${forceType(resolveInput(block.inputs.SIZE), 'number')}\n`;
      } case 'looks_changesizeby': {
        const change = forceType(resolveInput(block.inputs.CHANGE), 'number');
        return `target.size += ${change}\n`;
      } case 'looks_costume': {
        return `"${block.fields.COSTUME[0]}"`;
      } case 'looks_nextcostume': {
        return `target.currentCostume = (target.currentCostume + 1) % target.costumes.len\n`;
      } case 'looks_switchcostumeto': {
        return 'target.currentCostume = target.costumes.getKeys("name").index(' + forceType(resolveInput(block.inputs.COSTUME), 'string') + ')\n';
      } case 'looks_costumenumbername': {
        if (typeof block.fields.NUMBER_NAME === 'number') {
          return `target.currentCostume`;
        }
        return `target.costumes[target.currentCostume].name`;
      } case 'looks_changeeffectby': {
        return `target.effects["${convertEffectForOSL(block.fields.EFFECT[0])}"] += ${forceType(resolveInput(block.inputs.CHANGE), 'number')}\n`;
      } case 'looks_seteffectto': {
        return `target.effects["${convertEffectForOSL(block.fields.EFFECT[0])}"] = ${forceType(resolveInput(block.inputs.VALUE), 'number')}\n`;
      } case 'looks_cleargraphiceffects': {
        return `target.effects = ${defaultEffect}\n`;
      } case 'looks_switchbackdropto': {
        return 'stage.currentCostume = stage.costumes.getKeys("name").index("' + resolveInput(block.inputs.BACKDROP) + '")\n';
      } case 'sound_play': {
        return `sound target.sounds[${resolveInput(block.inputs.SOUND_MENU)}].md5ext "start"\n`;
      } case 'sound_playuntildone': {
        return `sound target.sounds[${resolveInput(block.inputs.SOUND_MENU)}].md5ext "play"\n`;
      } case 'sound_setvolumeto': {
        return `target.volume = ${resolveInput(block.inputs.VOLUME)}\n`;
      } case 'sound_seteffectto': {
        return `// sound effect would go here but its unsupported\n`;
      } case 'sound_sounds_menu': {
        return `"${block.fields.SOUND_MENU[0]}"`
      } case 'sensing_setdragmode': {
        return `target.draggable = ${block.fields.DRAG_MODE === 'draggable'}\n`;
      } case 'sensing_timer': {
        return `window_timer`
      } case 'sensing_resettimer': {
        return `start_timer = timer\n`;
      } case 'sensing_keypressed': {
        return `${forceType(resolveInput(block.inputs.KEY_OPTION), 'string')}.isKeyDown()`;
      } case 'sensing_keyoptions': {
        return `"${block.fields.KEY_OPTION[0]}"`;
      } case 'sensing_mousex': {
        return `mouse_x`;
      } case 'sensing_mousey': {
        return `mouse_y`;
      } case 'sensing_mousedown': {
        return `mouse_down`;
      } case 'sensing_of': {
        return '/* sensing_of not supported */';
      } case 'sensing_distancetomenu': {
        return `"${block.fields.DISTANCETOMENU[0]}"`
      } case 'sensing_distanceto': {
        const target = resolveInput(block.inputs.DISTANCETOMENU);
        if (target === '_mouse_') {
          return `dist(target.x * scale, target.y * scale, mouse_x, mouse_y)`;
        }
        return `dist(target.x * scale, target.y * scale, getTargetByName(${target}).x * scale, getTargetByName(${target}).y * scale)`;
      } case 'sensing_touchingobject': {
        const target = resolveInput(block.inputs.TOUCHINGOBJECTMENU);
        return `(${target} == "_edge_" ? isTouchingEdge(target) isTouching(target, getTargetByName(${target})))`;
      } case 'sensing_touchingobjectmenu': {
        return `"${block.fields.TOUCHINGOBJECTMENU[0]}"`
      } case 'sensing_askandwait': {
        const question = resolveInput(block.inputs.QUESTION);
        return `answerVar = (${question}).ask() ?? ""\n`;
      } case 'sensing_answer': {
        return `answerVar`;
      } case 'operator_mathop': {
        const operator = block.fields.OPERATOR[0];
        const input = resolveInput(block.inputs.NUM);
        switch (operator) {
          case 'abs': return `abs(${forceType(input, 'number')})`;
          case 'floor': return `floor(${forceType(input, 'number')})`;
          case 'ceiling': return `ceil(${forceType(input, 'number')})`;
          case 'sqrt': return `(${forceType(input, 'number')}).sqrt()`;
          case 'sin': return `(${forceType(input, 'number')}).sin()`;
          case 'cos': return `(${forceType(input, 'number')}).cos()`;
          case 'tan': return `(${forceType(input, 'number')}).tan()`;
          case 'asin': return `(${forceType(input, 'number')}).asin()`;
          case 'acos': return `(${forceType(input, 'number')}).acos()`;
          case 'atan': return `(${forceType(input, 'number')}).atan()`;
          default: return `${operator}(${forceType(input, 'number')})`;
        }
      } case 'operator_random': {
        const min = resolveInput(block.inputs.FROM);
        const max = resolveInput(block.inputs.TO);
        return `random(${forceType(min, 'number')}, ${forceType(max, 'number')})`;
      } case 'operator_letter_of': {
        const string = resolveInput(block.inputs.STRING);
        const input = resolveInput(block.inputs.LETTER);
        return `(${forceType(string, 'string')}[${forceType(input, 'number')}])`;
      } case 'operator_round': {
        const input = resolveInput(block.inputs.NUM);
        return `round(${forceType(input, 'number')})`;
      } case 'operator_equals': {
        const left = resolveInput(block.inputs.OPERAND1);
        const right = resolveInput(block.inputs.OPERAND2);
        return `(${forceType(left, 'string')} == ${forceType(right, 'string')})`;
      } case 'operator_gt': {
        const left = resolveInput(block.inputs.OPERAND1);
        const right = resolveInput(block.inputs.OPERAND2);
        return `(${forceType(left, 'number')} > ${forceType(right, 'number')})`;
      } case 'operator_lt': {
        const left = resolveInput(block.inputs.OPERAND1);
        const right = resolveInput(block.inputs.OPERAND2);
        return `(${forceType(left, 'number')} < ${forceType(right, 'number')})`;
      } case 'operator_add': {
        const left = resolveInput(block.inputs.NUM1) || 0;
        const right = resolveInput(block.inputs.NUM2) || 0;
        return `(${forceType(left, 'number')} + ${forceType(right, 'number')})`;
      } case 'operator_subtract': {
        const left = resolveInput(block.inputs.NUM1) || 0;
        const right = resolveInput(block.inputs.NUM2) || 0;
        return `(${forceType(left, 'number')} - ${forceType(right, 'number')})`;
      } case 'operator_multiply': {
        const left = resolveInput(block.inputs.NUM1) || 0; 
        const right = resolveInput(block.inputs.NUM2) || 0;
        return `(${forceType(left, 'number')} * ${forceType(right, 'number')})`;
      } case 'operator_divide': {
        const left = resolveInput(block.inputs.NUM1) || 0;
        const right = resolveInput(block.inputs.NUM2) || 1; // Default to 1 to avoid division by zero
        return `(${forceType(left, 'number')} / ${forceType(right, 'number')} == 0 ? 1 : ${forceType(right, 'number')})`;
      } case 'operator_mod': {
        const left = resolveInput(block.inputs.NUM1) || 0;
        const right = resolveInput(block.inputs.NUM2) || 1; // Default to 1 to avoid modulo by zero
        return `(${forceType(left, 'number')} % ${forceType(right, 'number')})`;
      } case 'operator_and': {
        const left = resolveInput(block.inputs.OPERAND1);
        const right = resolveInput(block.inputs.OPERAND2);
        return `(${forceType(left, 'boolean')} and ${forceType(right, 'boolean')})`;
      } case 'operator_or': {
        const left = resolveInput(block.inputs.OPERAND1);
        const right = resolveInput(block.inputs.OPERAND2);
        return `(${forceType(left, 'boolean')} or ${forceType(right, 'boolean')})`;
      } case 'operator_not': {
        const input = resolveInput(block.inputs.OPERAND);
        return `(${forceType(input, 'boolean')}).not()`;
      } case 'operator_join': {
        const left = resolveInput(block.inputs.STRING1);
        const right = resolveInput(block.inputs.STRING2);
        return `(${forceType(left, 'string')} ++ ${forceType(right, 'string')})`;
      } case 'operator_length': {
        const input = resolveInput(block.inputs.STRING);
        return `${forceType(input, 'string')}.len`;
      } case 'operator_contains': {
        const string = resolveInput(block.inputs.STRING1);
        const substring = resolveInput(block.inputs.STRING2);
        return `${forceType(string, 'string')}.contains(${forceType(substring, 'string')})`;
      } case 'pen_setPenColorToColor': {
        const color = resolveInput(block.inputs.COLOR);
        return `target.pen.color = ${color}\n`;
      } case 'pen_setPenSizeTo': {
        const size = forceType(resolveInput(block.inputs.SIZE), 'number');
        return `target.pen.size = ${size}\n`;
      } case 'pen_penDown': {
        return `target.pen.down = true\n`;
      } case 'pen_penUp': {
        return `target.pen.down = false\n`;
      } case 'pen_clear': {
        return `canv "pen" "clear"\ntarget.pen.points = []\n`;
      } case 'pen_setPenColorParamTo': {
        const param = block.inputs.COLOR_PARAM[0];
        const paramName = ['','transparency'][param];
        const color = resolveInput(block.inputs.VALUE);
        return `target.pen.params["${paramName}"] = ${color}\n`;
      } default:
        return `/* Unhandled block: ${block.opcode} */`;
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

targets = []
greenflag = []
threads = {}
window_timer = 0
start_timer = timer
renderOrder = []
targetNameCache = {}
answer = ""

scale = 1.3
window.resize(480 * scale, 400 * scale)

canv "create" "pen" 480 360

def runThread(func, object data, kill) (
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
    target @= targets[i]
    each f target.greenflag (
      runThread(f, target, true)
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
      if monitor.spriteName == null (
        monitor.value = targets[1].variables[monitor.params.VARIABLE]
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
  array keys @= broadcasts.getKeys()
  for i keys.len (
    array cur @= broadcasts[keys[i]]
    for j cur.len (
      cur[j].id = ouidNew()
    )
  )
  return 
)

def newCloneOf(object target) (
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
  }
  for i newTarget.cloneStart.len (
    local f @= newTarget.cloneStart[i]
    runThread(f, newTarget, false)
  )
  void targets.append(newTarget)
  void renderOrder.append(newTarget)
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
  for i renderOrder.len (
    local target @= renderOrder[i]
    if target.shown (
      if target.touching_mouse and mouse_ondown (
        click(target)
      )
      keyPressed(all_hit)
      goto target.x * scale target.y - 20 * scale
      direction target.direction
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
      // array effects @= target.effects.getKeys()
      // for i effects.len (
      //   effect effects[i] target.effects[effects[i]]
      // )
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
  goto 0 0
)\n\n`;
  for (let i = 0; i < file.targets.length; i++) {
    const target = file.targets[i];
    target.num = i + 1;
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

    let sounds = {};
    for (const key in target.sounds) {
      sounds[target.sounds[key].name] = target.sounds[key];
    }

    let broadcasts = {};
    for (const name of Object.values(target.broadcasts)) {
      broadcasts[name] = [];
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
  size: ${target.size ?? 100},
  costumes: ${JSON.stringify(target.costumes.map((v, i) => { v.id = i + ":" + v.name; return v}) ?? [], null, 2)},
  sounds: ${JSON.stringify(sounds, null, 2)},
  variables: ${JSON.stringify(vars, null, 2)},
  lists: ${JSON.stringify(lists, null, 2)},
  shown: ${target.visible ?? true},
  currentCostume: ${(target.currentCostume ?? 0) + 1},
  procedures: {},
  pen: {},
  effects: ${JSON.stringify(defaultEffect, null, 2)},
  goto: def(object target) -> (
    self.gotoXY(target.x, target.y)
  ),
  gotoXY: def(number x, number y) -> (
    self.x = x
    self.y = y
  )
})
void renderOrder.append(targets[-1])\n`;
  }

  source += `

stage @= targets[1]

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

  for (let i = 0; i < file.targets.length; i++) {
    const target = file.targets[i];
    source += `\n// target ${i+1}\ntarget @= targets[${i+1}]\n`;
    for (let k = 0; k < Object.keys(target.blocks).length; k++) {
      const id = Object.keys(target.blocks)[k];
      const block = target.blocks[id];
      block.id = id
      blocks = target.blocks;
      target.num = i + 1;
      if (block.topLevel && block.next !== null && block.shadow === false) {
        source += resolveBlock(block, target);
      }
    }
  }

  source += `\n\ngreenflag()\nmainloop:\nrenderFrame()\nwindow_timer = timer - start_timer`;

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