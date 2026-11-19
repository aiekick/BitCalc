# Change Log

All notable changes to the "BitCalc" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.0.2] - 2026-11-19

### Added

- Struct Decoder: **Markdown** and **C++ comment** exports of the Byte by byte comparison, laid out like the grid: for From and for To, a line of offsets and the bytes, each word most significant byte first, 16 bytes per line; the bytes that differ between From and To are marked with `*` (the Markdown export is a text block).

## [0.0.1] - 2026-11-18

First release.

- **BitCalc tab** in the bottom panel with two views, Calculator and Struct Decoder. Each view keeps its settings and content across restarts; the defaults (word size, sign, byte order, bit numbering) come from the `bitcalc.*` settings. Editor context menu: evaluate the selection in the calculator, decode it as a buffer, use it as a structure.
- **Calculator**: programmer calculator on 8 to 128 bits, signed or unsigned. Editable HEX, DEC, OCT and BIN fields, clickable bits, C-like integer expressions, NOT, NEG, shifts, rotations and byte swap. Conversion between layouts (LE/BE, LSB0/MSB0) with the bytes of both in memory.
- **Struct Decoder**: decodes a raw buffer with C-like declarations: structures, bitfields, arrays, enums with an underlying type, typedefs and nested structures. The editor has syntax highlighting, an automatic formatter, templates and a help box listing the types and the syntax.
- **ICD layout**: the message is a sequence of 8, 16, 32 or 64-bit words; the fields follow each other inside the words and never straddle two, with no compiler rule. The field table gives the word, the first and last bit and the width of each field, and its value in decimal (editable, with a list for enums), hex, octal and binary, with an optional view numbering each bit in LSB0 or MSB0.
- **From / To conversion**: the same structure in two layouts (byte order and bit numbering), the values of the fields being kept. Both buffers are editable, shown as bytes or as 16, 32 or 64-bit words, copied as text or as a C array, and compared word by word in a byte grid.
- **Exports** of the field table as a Markdown table or a C++ comment block.
- **Named configurations** saved as `.vscode/<label>.bc` files, holding both views, to switch between messages.
