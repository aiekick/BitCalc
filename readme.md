# BitCalc

A programmer calculator and a bitfield structure decoder, in the VS Code panel: hex, decimal, octal and binary views of a value, clickable bits, little or big endian, LSB0 or MSB0 bit numbering.

![VS Code](https://img.shields.io/badge/VS%20Code-^1.80.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## Where to find it

BitCalc adds a **BitCalc** tab to the bottom panel, next to Terminal and Output, with two views: **Calculator** and **Struct Decoder**. You can drag either view to the side bar. The commands `BitCalc: Open Calculator` and `BitCalc: Open Struct Decoder` open them from the Command Palette.

Every choice made in a view (word size, signed mode, byte order, bit numbering) and its content (value, expression, structure, buffer, offset) is saved and comes back when you reopen the view, even after restarting VS Code. The saved state is global: it is the same in every workspace.

## Calculator

Works like the programmer mode of the Windows calculator.

- **Word size**: 8, 16, 32, 64 or 128 bits. Every result is truncated to that size.
- **Signed**: the decimal value and the operations use two's complement. Unchecked, the value is unsigned.
- **HEX, DEC, OCT, BIN**: type in any of the four fields, the others follow. Spaces, `_` and `'` are digit separators and the `0x`, `0o`, `0b` prefixes are accepted. A field turns red when the text is not a number, and orange when the value had to be truncated to the word size. **Copy** copies the value without separators, with its C prefix (`0x`, `0`, `0b`).
- **Bits**: click a bit to toggle it. The most significant bit is at the top left. The number under each bit is its index: counted from the least significant bit in **LSB0**, from the most significant bit in **MSB0**.
- **Operations**: `NOT`, `NEG` (two's complement negation), `<< 1`, `>> 1` (arithmetic shift when signed), `ROL` and `ROR` (rotation by one bit within the word), `SWAP` (reverse the byte order), `CLR`.

### Converting between layouts

The **From** controls give the layout of the value: bit numbering (**LSB0** or **MSB0**) and byte order (**LE** or **BE**). The **To** controls give the layout to convert it to. Each bit keeps its number: bit 3 in the From numbering is bit 3 in the To numbering, so going from LSB0 to MSB0 reverses the bits of the word, and going from LE to BE reverses its bytes.

- **Converted**: the converted value, as a reader using the From layout finds it in memory, in hex, decimal, octal and binary, with copy buttons.
- **Memory**: the bytes of the value (From) and of its conversion (To) in memory order, the bytes that differ highlighted.
- **⇄** swaps From and To and replaces the value by its conversion, so pressing it twice gives the value back.

For instance, `0x12345678` in LE LSB0 converted to BE MSB0 gives `0x482C6A1E`: bits reversed (`0x1E6A2C48`), then bytes reversed.

### Expressions

The expression field evaluates integer expressions when you press `Enter`:

| Element | Syntax |
|---|---|
| Literals | `42`, `0x2A`, `0o52`, `0b101010`, with `_` as separator |
| Unary | `-x`, `+x`, `~x` |
| Binary, by decreasing precedence | `*` `/` `%`, then `+` `-`, then `<<` `>>`, then `&`, then `^`, then `|` |
| Grouping | `( )` |

The precedence is the one of C. Every intermediate result is truncated to the word size, so in 8 bits signed `127 + 1` gives `-128`. Division truncates towards zero. On error, the message gives the column.

## Struct Decoder

Decodes a raw buffer with a C structure definition, bitfields included. Each field is shown in decimal, hex, octal and binary.

**Structure**: C declarations. Typedefs and enums first if any, then the structures, which can use the enums and each other. The last structure is decoded; when there are several, a list above the field table picks another one. A plain list of fields without braces works too. Comments are allowed.

```c
typedef uint32_t t_date;    // alias of a scalar, enum or structure type

enum MsgType : uint8_t {    // underlying type, int when omitted
    MSG_PING = 1,
    MSG_PONG,               // previous + 1
    MSG_DATA = 0x10
};

struct Header {             // typedef struct { ... } Header; works too
    MsgType  type;          // enum field
    uint8_t  version : 4;   // bitfield
    uint8_t          : 2;   // anonymous padding bits
    uint8_t  flags   : 2;
    uint16_t length;        // plain field
};

struct Message {
    Header   header;        // nested structure, shown as header.type, header.version...
    uint8_t  data[4];       // array
    t_date   date;          // typedef alias
};
```

The declarations are coloured as you type, and the lines with an error are underlined. **Format** (or `Shift+Alt+F` in the structure) indents them and aligns the types, names, bit widths, enumerator values and trailing comments in columns; `Ctrl+Z` undoes it. Text that cannot be formatted without changing it, such as a missing `}`, is left as is.

Enumerators take a number or an expression that may use earlier enumerators (`KIND_C = KIND_A << 4`). An enum field is stored as its underlying type, can be a bitfield, and its value is shown as `NAME (value)`.

The **Template…** list above the structure replaces it with a ready-made one: an empty structure, a bitfields example, an enum with nested structures, the IPv4 and UDP headers, an RGB565 pixel, the fields of an IEEE 754 float and double. Templates written for a given byte order or bit numbering (the network headers are big endian and MSB0) also switch these options. `Ctrl+Z` in the structure brings back what was there before. The **?** button next to it shows the supported types, the syntax and the layout rules.

Known types: `uint8_t` to `uint64_t` and `int8_t` to `int64_t` (also written `uint8`, `u8`, `int8`, `i8`, `s8`...), `char`, `unsigned char`, `byte`, `short`, `int`, `unsigned`, `long long` and their `signed` / `unsigned` forms, `bool`, `float`, `double` (also `f32`, `f64`, `float32`, `float64`). `long` is refused because its size depends on the platform. `const`, `volatile` and `std::` are ignored. Typedefs of arrays, pointers, unions and structures defined inside another one are not supported: declare the structures before.

**Buffer**: hex bytes written as `01 02 0A FF`, `0x01, 0x02`, `\x01\x02`, `{ 0x1, 0x2 }` or `01020AFF`. **Offset** skips the given number of bytes before the structure.

**Layout rules**, chosen to be predictable:

- The structure is packed: no alignment padding is added. Write the padding fields yourself when the real structure has some.
- Plain fields are read with the chosen byte order (**LE** or **BE**).
- Consecutive bitfields share a storage unit of the size of their declared type while they fit in it. A bitfield of another type size, a bitfield that does not fit, a plain field or a `: 0` bitfield starts a new unit. This is what MSVC does; GCC and Clang can also mix types in one unit.
- The storage unit is read with the chosen byte order, then the bitfields are allocated from its bit 0: the least significant bit in **LSB0**, the most significant one in **MSB0**.

Each row shows the offset (`+byte` for a plain field, `+byte.bit` for a bitfield, the bit being numbered in the chosen bit order inside its unit), the width in bits with the bit range, and the value. Signed fields are sign extended. Fields the buffer is too short for are empty.

### Converting between layouts

The toolbar has two layouts: **From**, the byte order and bit numbering the buffer is written in, and **To**, the layout to convert it to. For instance, a structure written by a little endian compiler that allocates bitfields from the LSB (**From** LE LSB0) and expected by a big endian target that allocates them from the MSB (**To** BE MSB0).

The fields keep the same values in both layouts; only the bytes change. Under the field table, **Bytes** shows the buffer (**From**) and the same structure stored in the other layout (**To**), byte by byte, with the bytes that differ highlighted. The **Hex** and **C array** buttons copy either one, as `5A F4 34 12` or as `{ 0x5A, 0xF4, 0x34, 0x12 }`, ready to paste in a unit test.

**⇄** swaps the two layouts and replaces the buffer by its conversion, so the values stay the same.

### Editing values

The **DEC** column can be edited: type a value and press `Enter`, the buffer and its conversion are updated. Integer fields accept the calculator expressions (`0x1F`, `-1`, `1 << 3`) and are truncated to the field width, enum fields also accept their enumerator names, `bool` fields accept `true`, `false`, `1` or `0`, `float` and `double` fields accept any number. `Escape` cancels. When the buffer is shorter than the structure, it is completed with zeros. Starting from an empty buffer, this builds the bytes of a structure field by field.

## From the editor

Right-click in the editor and open the **BitCalc** submenu, or use the Command Palette:

| Command | What it does |
|---|---|
| Evaluate Selection in Calculator | Evaluates the selection (or the number under the cursor) in the calculator |
| Decode Selection as Buffer | Puts the selected hex bytes in the struct decoder buffer |
| Use Selection as Structure | Puts the selected C structure in the struct decoder |

## Settings

These settings are only the starting values. Everything can be changed in the views themselves, from one calculation to the next, and the views save what you chose: the settings are used again only before the first change.

| Setting | Default | Description |
|---|---|---|
| `bitcalc.wordSize` | `64` | Word size of the calculator: 8, 16, 32, 64 or 128 |
| `bitcalc.signed` | `true` | Signed (two's complement) mode of the calculator |
| `bitcalc.endianness` | `little` | Byte order: `little` or `big`. The struct decoder converts to the other one |
| `bitcalc.bitOrder` | `lsb0` | Bit numbering: `lsb0` or `msb0`. The struct decoder converts to the other one |

## Build

```sh
npm install
npm run check     # type check
npm test          # unit tests
npm run package   # builds the bitcalc-<version>.vsix
node scripts/genIcon.js   # regenerates medias/icon.png
```
