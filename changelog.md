# Change Log

All notable changes to the "BitCalc" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.0.4] - 2026-11-19

### Changed

- Struct Decoder: an array of structures is a foldable section of the field table, with only the chosen elements shown (element 0 by default): its header gives the number of elements and an **Indices** field taking an index (`0`), a range (`2-5`, `2..5`) or a list (`0,1,3,6`). Each shown element is introduced by its name (`items[3]`). Large arrays no longer fill the table with thousands of rows; the exports contain the chosen elements too.

## [0.0.3] - 2026-11-19

### Added

- Struct Decoder: **CSV** export of the field table, cells separated by `;` (the shown columns, with the word rows of the BIN Word view).

### Changed

- Exports of the BIN Word view: the values of a word holding several fields are given on its word row only, no longer also on its last field.
- Readme and help: the array syntax and the forms not supported yet (array size given by a constant or an expression, several dimensions, structure defined in a field declaration, typedefs of arrays) are documented.
- Changelog and readme: the Word From / Word To values and the word values of the byte grid exports are read in the byte order of their layout (the 0.0.2 entry said they matched the words formats of the buffers, which group the bytes as they are).

## [0.0.2] - 2026-11-19

### Added

- Struct Decoder: the words formats of the buffers group the bytes in the order of the buffer, whatever the byte order of the layout (`45 03 00 00` is `0x45030000` on both sides): they show the buffer as it is sent, not the values of its words, which the Word From / Word To columns and the byte grid exports give.
- Struct Decoder: **Columns** buttons above the field table show or hide each column (Word, Bit min, Bit max, Bits, Field, Type, DEC, HEX, OCT, Mask From, Mask To, Word From, Word To, BIN From, BIN To); the exports follow the shown columns, and the choice is kept.
- Struct Decoder: optional **Word From** and **Word To** columns (hidden by default), the hex value of the whole word in each layout, on the last row of each word, on the word size, read in the byte order of its layout.
- Struct Decoder: **Mask From** and **Mask To** columns, the bits of each field in the value of its word in each layout (field = (word & mask) >> lowest bit of the mask).
- Struct Decoder: **BIN Word** view: BIN From and BIN To show the whole word holding the field, the bits of the field highlighted (in the exports, dots for the other bits, and after the last field of a word holding several fields, a row with the word number, its values and its whole binary form).
- Struct Decoder: **Order** choice for the Byte by byte grid and its exports: **Word** (default), each word most significant byte first so that it reads as its value, or **Memory**, the bytes in memory order (`+0 +1 +2 +3`) as the buffer in bytes.
- Struct Decoder: **Markdown** and **C++ comment** exports of the Byte by byte comparison, laid out like the grid: for From and for To, a line of offsets and the bytes, each word most significant byte first, all the words on one line, and a line under the bytes gives the value of each word (`= 0x00000345`), read in the byte order of its layout (the Markdown export is a text block).

## [0.0.1] - 2026-11-18

First release.

- **BitCalc tab** in the bottom panel with two views, Calculator and Struct Decoder. Each view keeps its settings and content across restarts; the defaults (word size, sign, byte order, bit numbering) come from the `bitcalc.*` settings. Editor context menu: evaluate the selection in the calculator, decode it as a buffer, use it as a structure.
- **Calculator**: programmer calculator on 8 to 128 bits, signed or unsigned. Editable HEX, DEC, OCT and BIN fields, clickable bits, C-like integer expressions, NOT, NEG, shifts, rotations and byte swap. Conversion between layouts (LE/BE, LSB0/MSB0) with the bytes of both in memory.
- **Struct Decoder**: decodes a raw buffer with C-like declarations: structures, bitfields, arrays, enums with an underlying type, typedefs and nested structures. The editor has syntax highlighting, an automatic formatter, templates and a help box listing the types and the syntax.
- **ICD layout**: the message is a sequence of 8, 16, 32 or 64-bit words; the fields follow each other inside the words and never straddle two, with no compiler rule. The field table gives the word, the first and last bit and the width of each field, and its value in decimal (editable, with a list for enums), hex, octal and binary, with an optional view numbering each bit in LSB0 or MSB0.
- **From / To conversion**: the same structure in two layouts (byte order and bit numbering), the values of the fields being kept. Both buffers are editable, shown as bytes or as 16, 32 or 64-bit words, copied as text or as a C array, and compared word by word in a byte grid.
- **Exports** of the field table as a Markdown table or a C++ comment block.
- **Named configurations** saved as `.vscode/<label>.bc` files, holding both views, to switch between messages.
