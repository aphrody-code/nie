/**
 * Lua 5.2 Bytecode Parser
 *
 * Parses compiled Lua 5.2 bytecode (.lua.bin files) and extracts:
 * - Function prototypes
 * - Constants (strings, numbers)
 * - Instructions (opcodes)
 * - Debug info (line numbers, local names, upvalue names)
 *
 * Based on Lua 5.2 bytecode format specification.
 * Reference: https://wubingzheng.github.io/build-lua-in-rust/en/ch01-02
 *
 * Header format (Lua 5.2):
 * - Signature: 0x1B 0x4C 0x75 0x61 (ESC + "Lua")
 * - Version: 0x52 (Lua 5.2)
 * - Format: 0x00 (official)
 * - Endianness, int size, size_t size, instruction size, number size, integral flag
 * - LUAC_DATA: 0x19 0x93 0x0D 0x0A 0x1A 0x0A
 *
 * @module lua-bytecode
 */

// Lua 5.2 Opcodes
export const LuaOpcode = {
	MOVE: 0,
	LOADK: 1,
	LOADKX: 2,
	LOADBOOL: 3,
	LOADNIL: 4,
	GETUPVAL: 5,
	GETTABUP: 6,
	GETTABLE: 7,
	SETTABUP: 8,
	SETUPVAL: 9,
	SETTABLE: 10,
	NEWTABLE: 11,
	SELF: 12,
	ADD: 13,
	SUB: 14,
	MUL: 15,
	DIV: 16,
	MOD: 17,
	POW: 18,
	UNM: 19,
	NOT: 20,
	LEN: 21,
	CONCAT: 22,
	JMP: 23,
	EQ: 24,
	LT: 25,
	LE: 26,
	TEST: 27,
	TESTSET: 28,
	CALL: 29,
	TAILCALL: 30,
	RETURN: 31,
	FORLOOP: 32,
	FORPREP: 33,
	TFORCALL: 34,
	TFORLOOP: 35,
	SETLIST: 36,
	CLOSURE: 37,
	VARARG: 38,
	EXTRAARG: 39,
} as const;
export type LuaOpcode = (typeof LuaOpcode)[keyof typeof LuaOpcode];

export const OPCODE_NAMES: Record<LuaOpcode, string> = {
	[LuaOpcode.MOVE]: "MOVE",
	[LuaOpcode.LOADK]: "LOADK",
	[LuaOpcode.LOADKX]: "LOADKX",
	[LuaOpcode.LOADBOOL]: "LOADBOOL",
	[LuaOpcode.LOADNIL]: "LOADNIL",
	[LuaOpcode.GETUPVAL]: "GETUPVAL",
	[LuaOpcode.GETTABUP]: "GETTABUP",
	[LuaOpcode.GETTABLE]: "GETTABLE",
	[LuaOpcode.SETTABUP]: "SETTABUP",
	[LuaOpcode.SETUPVAL]: "SETUPVAL",
	[LuaOpcode.SETTABLE]: "SETTABLE",
	[LuaOpcode.NEWTABLE]: "NEWTABLE",
	[LuaOpcode.SELF]: "SELF",
	[LuaOpcode.ADD]: "ADD",
	[LuaOpcode.SUB]: "SUB",
	[LuaOpcode.MUL]: "MUL",
	[LuaOpcode.DIV]: "DIV",
	[LuaOpcode.MOD]: "MOD",
	[LuaOpcode.POW]: "POW",
	[LuaOpcode.UNM]: "UNM",
	[LuaOpcode.NOT]: "NOT",
	[LuaOpcode.LEN]: "LEN",
	[LuaOpcode.CONCAT]: "CONCAT",
	[LuaOpcode.JMP]: "JMP",
	[LuaOpcode.EQ]: "EQ",
	[LuaOpcode.LT]: "LT",
	[LuaOpcode.LE]: "LE",
	[LuaOpcode.TEST]: "TEST",
	[LuaOpcode.TESTSET]: "TESTSET",
	[LuaOpcode.CALL]: "CALL",
	[LuaOpcode.TAILCALL]: "TAILCALL",
	[LuaOpcode.RETURN]: "RETURN",
	[LuaOpcode.FORLOOP]: "FORLOOP",
	[LuaOpcode.FORPREP]: "FORPREP",
	[LuaOpcode.TFORCALL]: "TFORCALL",
	[LuaOpcode.TFORLOOP]: "TFORLOOP",
	[LuaOpcode.SETLIST]: "SETLIST",
	[LuaOpcode.CLOSURE]: "CLOSURE",
	[LuaOpcode.VARARG]: "VARARG",
	[LuaOpcode.EXTRAARG]: "EXTRAARG",
};

// Constant types
export const LuaConstantType = {
	NIL: 0,
	BOOLEAN: 1,
	NUMBER: 3,
	STRING: 4,
} as const;
export type LuaConstantType = (typeof LuaConstantType)[keyof typeof LuaConstantType];

export interface LuaConstant {
	type: LuaConstantType;
	value: null | boolean | number | string;
}

export interface LuaInstruction {
	raw: number;
	opcode: number;
	opcodeName: string;
	A: number;
	B: number;
	C: number;
	Bx: number;
	sBx: number;
	Ax: number;
}

export interface LuaLocal {
	name: string;
	startPC: number;
	endPC: number;
}

export interface LuaUpvalue {
	name: string;
	inStack: boolean;
	index: number;
}

export interface LuaPrototype {
	lineDefined: number;
	lastLineDefined: number;
	numParams: number;
	isVararg: boolean;
	maxStackSize: number;
	instructions: LuaInstruction[];
	constants: LuaConstant[];
	prototypes: LuaPrototype[];
	upvalues: LuaUpvalue[];
	source: string;
	lineInfo: number[];
	locals: LuaLocal[];
}

export interface LuaBytecodeHeader {
	signature: string;
	version: number;
	format: number;
	endianness: number;
	intSize: number;
	sizeTSize: number;
	instructionSize: number;
	numberSize: number;
	integralFlag: number;
	luacData: Uint8Array;
}

export interface LuaBytecode {
	header: LuaBytecodeHeader;
	mainPrototype: LuaPrototype;
}

/**
 * Lua 5.2 Bytecode Reader
 */
export class LuaBytecodeReader {
	private buffer: Uint8Array;
	private pos = 0;
	private littleEndian = true;
	private intSize = 4;
	private sizeTSize = 8;
	private instructionSize = 4;
	private numberSize = 8;

	constructor(buffer: Uint8Array) {
		this.buffer = buffer;
	}

	private readByte(): number {
		return this.buffer[this.pos++];
	}

	private readBytes(n: number): Uint8Array {
		const bytes = this.buffer.slice(this.pos, this.pos + n);
		this.pos += n;
		return bytes;
	}

	private readInt(): number {
		const bytes = this.readBytes(this.intSize);
		let value = 0;
		if (this.littleEndian) {
			for (let i = this.intSize - 1; i >= 0; i--) {
				value = value * 256 + bytes[i];
			}
		} else {
			for (let i = 0; i < this.intSize; i++) {
				value = value * 256 + bytes[i];
			}
		}
		return value;
	}

	private readSizeT(): number {
		const bytes = this.readBytes(this.sizeTSize);
		let value = 0;
		if (this.littleEndian) {
			for (let i = Math.min(this.sizeTSize - 1, 6); i >= 0; i--) {
				value = value * 256 + bytes[i];
			}
		} else {
			for (let i = 0; i < Math.min(this.sizeTSize, 7); i++) {
				value = value * 256 + bytes[i];
			}
		}
		return value;
	}

	private readNumber(): number {
		const bytes = this.readBytes(this.numberSize);
		if (this.numberSize === 8) {
			// IEEE 754 double
			const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
			return view.getFloat64(0, this.littleEndian);
		}
		if (this.numberSize === 4) {
			// IEEE 754 float
			const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
			return view.getFloat32(0, this.littleEndian);
		}
		throw new Error(`Unsupported number size: ${this.numberSize}`);
	}

	private readString(): string {
		const size = this.readSizeT();
		if (size === 0) return "";
		const bytes = this.readBytes(size);
		// Remove trailing null byte if present
		const strBytes = bytes[size - 1] === 0 ? bytes.slice(0, -1) : bytes;
		return new TextDecoder("utf-8").decode(strBytes);
	}

	private readInstruction(): LuaInstruction {
		const bytes = this.readBytes(this.instructionSize);
		let raw = 0;
		if (this.littleEndian) {
			for (let i = this.instructionSize - 1; i >= 0; i--) {
				raw = raw * 256 + bytes[i];
			}
		} else {
			for (let i = 0; i < this.instructionSize; i++) {
				raw = raw * 256 + bytes[i];
			}
		}

		// Lua 5.2 instruction format:
		// iABC:  C(9) | B(9) | k(1) | A(8) | Op(6)
		// iABx:  Bx(18)            | A(8) | Op(6)
		// iAsBx: sBx(18)           | A(8) | Op(6)
		// iAx:   Ax(26)                   | Op(6)

		const opcode = raw & 0x3f;
		const A = (raw >> 6) & 0xff;
		const C = (raw >> 14) & 0x1ff;
		const B = (raw >> 23) & 0x1ff;
		const Bx = (raw >> 14) & 0x3ffff;
		const sBx = Bx - 131071; // MAXARG_sBx = 131071
		const Ax = (raw >> 6) & 0x3ffffff;

		return {
			raw,
			opcode,
			opcodeName: OPCODE_NAMES[opcode as LuaOpcode] || `OP_${opcode}`,
			A,
			B,
			C,
			Bx,
			sBx,
			Ax,
		};
	}

	private readConstant(): LuaConstant {
		const type = this.readByte() as LuaConstantType;

		switch (type) {
			case LuaConstantType.NIL:
				return { type, value: null };

			case LuaConstantType.BOOLEAN:
				return { type, value: this.readByte() !== 0 };

			case LuaConstantType.NUMBER:
				return { type, value: this.readNumber() };

			case LuaConstantType.STRING:
				return { type, value: this.readString() };

			default:
				throw new Error(`Unknown constant type: ${type}`);
		}
	}

	private readUpvalue(): { inStack: boolean; index: number } {
		const inStack = this.readByte() !== 0;
		const index = this.readByte();
		return { inStack, index };
	}

	private readPrototype(parentSource = ""): LuaPrototype {
		const lineDefined = this.readInt();
		const lastLineDefined = this.readInt();
		const numParams = this.readByte();
		const isVararg = this.readByte() !== 0;
		const maxStackSize = this.readByte();

		// Instructions
		const codeSize = this.readInt();
		const instructions: LuaInstruction[] = [];
		for (let i = 0; i < codeSize; i++) {
			instructions.push(this.readInstruction());
		}

		// Constants
		const constantsSize = this.readInt();
		const constants: LuaConstant[] = [];
		for (let i = 0; i < constantsSize; i++) {
			constants.push(this.readConstant());
		}

		// Nested prototypes
		const protosSize = this.readInt();
		const prototypes: LuaPrototype[] = [];
		for (let i = 0; i < protosSize; i++) {
			prototypes.push(this.readPrototype(parentSource));
		}

		// Upvalues
		const upvaluesSize = this.readInt();
		const upvalues: LuaUpvalue[] = [];
		for (let i = 0; i < upvaluesSize; i++) {
			const upval = this.readUpvalue();
			upvalues.push({ ...upval, name: "" });
		}

		// Source name
		const source = this.readString() || parentSource;

		// Line info
		const lineInfoSize = this.readInt();
		const lineInfo: number[] = [];
		for (let i = 0; i < lineInfoSize; i++) {
			lineInfo.push(this.readInt());
		}

		// Locals
		const localsSize = this.readInt();
		const locals: LuaLocal[] = [];
		for (let i = 0; i < localsSize; i++) {
			const name = this.readString();
			const startPC = this.readInt();
			const endPC = this.readInt();
			locals.push({ name, startPC, endPC });
		}

		// Upvalue names
		const upvalueNamesSize = this.readInt();
		for (let i = 0; i < upvalueNamesSize && i < upvalues.length; i++) {
			upvalues[i].name = this.readString();
		}

		return {
			lineDefined,
			lastLineDefined,
			numParams,
			isVararg,
			maxStackSize,
			instructions,
			constants,
			prototypes,
			upvalues,
			source,
			lineInfo,
			locals,
		};
	}

	public parse(): LuaBytecode {
		// Header
		const signature = new TextDecoder().decode(this.readBytes(4));
		if (signature !== "\x1bLua") {
			throw new Error(`Invalid Lua signature: ${signature}`);
		}

		const version = this.readByte();
		if (version !== 0x52) {
			console.warn(`Warning: Expected Lua 5.2 (0x52), got 0x${version.toString(16)}`);
		}

		const format = this.readByte();
		const endianness = this.readByte();
		this.littleEndian = endianness === 1;

		this.intSize = this.readByte();
		this.sizeTSize = this.readByte();
		this.instructionSize = this.readByte();
		this.numberSize = this.readByte();
		const integralFlag = this.readByte();

		const luacData = this.readBytes(6);

		const header: LuaBytecodeHeader = {
			signature,
			version,
			format,
			endianness,
			intSize: this.intSize,
			sizeTSize: this.sizeTSize,
			instructionSize: this.instructionSize,
			numberSize: this.numberSize,
			integralFlag,
			luacData,
		};

		// Main prototype
		const mainPrototype = this.readPrototype();

		return { header, mainPrototype };
	}
}

/**
 * Parse Lua 5.2 bytecode from a Uint8Array
 */
export function parseLuaBytecode(buffer: Uint8Array): LuaBytecode {
	const reader = new LuaBytecodeReader(buffer);
	return reader.parse();
}

/**
 * Extract all string constants from bytecode
 */
export function extractStrings(bytecode: LuaBytecode): string[] {
	const strings: string[] = [];

	function extractFromPrototype(proto: LuaPrototype) {
		for (const constant of proto.constants) {
			if (constant.type === LuaConstantType.STRING && constant.value) {
				strings.push(constant.value as string);
			}
		}
		for (const nested of proto.prototypes) {
			extractFromPrototype(nested);
		}
	}

	extractFromPrototype(bytecode.mainPrototype);
	return strings;
}

/**
 * Generate a human-readable disassembly of the bytecode
 */
export function disassemble(bytecode: LuaBytecode): string {
	const lines: string[] = [];

	function disassemblePrototype(proto: LuaPrototype, indent = "") {
		lines.push(
			`${indent}; function (${proto.numParams} params, ${proto.maxStackSize} slots, ${proto.upvalues.length} upvalues, ${proto.locals.length} locals, ${proto.constants.length} constants, ${proto.prototypes.length} functions)`
		);

		if (proto.source) {
			lines.push(`${indent}; source: ${proto.source}`);
		}

		// Constants
		if (proto.constants.length > 0) {
			lines.push(`${indent}; constants:`);
			proto.constants.forEach((c, i) => {
				const val = c.type === LuaConstantType.STRING ? `"${c.value}"` : String(c.value);
				lines.push(`${indent};   [${i}] = ${val}`);
			});
		}

		// Instructions
		lines.push(`${indent}; code:`);
		proto.instructions.forEach((instr, i) => {
			const line = proto.lineInfo[i] ? `[${proto.lineInfo[i]}]` : "";
			const args = formatInstruction(instr, proto.constants);
			lines.push(`${indent}  ${i + 1}\t${line}\t${instr.opcodeName}\t${args}`);
		});

		// Nested prototypes
		proto.prototypes.forEach((nested, i) => {
			lines.push(`${indent}; function [${i}]:`);
			disassemblePrototype(nested, `${indent}  `);
		});
	}

	disassemblePrototype(bytecode.mainPrototype);
	return lines.join("\n");
}

function formatInstruction(instr: LuaInstruction, constants: LuaConstant[]): string {
	const { opcode, A, B, C, Bx, sBx } = instr;

	const getConstant = (idx: number): string => {
		if (idx >= 256) {
			// RK(x) - constant index
			const realIdx = idx - 256;
			if (realIdx < constants.length) {
				const c = constants[realIdx];
				return c.type === LuaConstantType.STRING ? `"${c.value}"` : String(c.value);
			}
		}
		return String(idx);
	};

	switch (opcode) {
		case LuaOpcode.MOVE:
			return `${A} ${B}`;
		case LuaOpcode.LOADK:
			return `${A} ${Bx}\t; ${getConstant(Bx + 256)}`;
		case LuaOpcode.LOADBOOL:
			return `${A} ${B} ${C}`;
		case LuaOpcode.LOADNIL:
			return `${A} ${B}`;
		case LuaOpcode.GETUPVAL:
		case LuaOpcode.SETUPVAL:
			return `${A} ${B}`;
		case LuaOpcode.GETTABUP:
		case LuaOpcode.SETTABUP:
			return `${A} ${B} ${getConstant(C)}`;
		case LuaOpcode.GETTABLE:
		case LuaOpcode.SETTABLE:
			return `${A} ${B} ${getConstant(C)}`;
		case LuaOpcode.NEWTABLE:
			return `${A} ${B} ${C}`;
		case LuaOpcode.SELF:
			return `${A} ${B} ${getConstant(C)}`;
		case LuaOpcode.ADD:
		case LuaOpcode.SUB:
		case LuaOpcode.MUL:
		case LuaOpcode.DIV:
		case LuaOpcode.MOD:
		case LuaOpcode.POW:
			return `${A} ${getConstant(B)} ${getConstant(C)}`;
		case LuaOpcode.UNM:
		case LuaOpcode.NOT:
		case LuaOpcode.LEN:
			return `${A} ${B}`;
		case LuaOpcode.CONCAT:
			return `${A} ${B} ${C}`;
		case LuaOpcode.JMP:
			return `${A} ${sBx}`;
		case LuaOpcode.EQ:
		case LuaOpcode.LT:
		case LuaOpcode.LE:
			return `${A} ${getConstant(B)} ${getConstant(C)}`;
		case LuaOpcode.TEST:
			return `${A} ${C}`;
		case LuaOpcode.TESTSET:
			return `${A} ${B} ${C}`;
		case LuaOpcode.CALL:
		case LuaOpcode.TAILCALL:
			return `${A} ${B} ${C}`;
		case LuaOpcode.RETURN:
			return `${A} ${B}`;
		case LuaOpcode.FORLOOP:
		case LuaOpcode.FORPREP:
			return `${A} ${sBx}`;
		case LuaOpcode.TFORCALL:
			return `${A} ${C}`;
		case LuaOpcode.TFORLOOP:
			return `${A} ${sBx}`;
		case LuaOpcode.SETLIST:
			return `${A} ${B} ${C}`;
		case LuaOpcode.CLOSURE:
			return `${A} ${Bx}`;
		case LuaOpcode.VARARG:
			return `${A} ${B}`;
		default:
			return `${A} ${B} ${C}`;
	}
}

const LuaBytecodeUtils = {
	parseLuaBytecode,
	extractStrings,
	disassemble,
	LuaOpcode,
	OPCODE_NAMES,
	LuaConstantType,
};

export default LuaBytecodeUtils;
