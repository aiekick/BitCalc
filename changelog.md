# Change Log

All notable changes to the "BitCalc" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.0.21] - 2026-11-18

### Added

- Config bar: **Reload** loads the selected configuration again from its file, dropping the changes made since (a template put in the structure, edited values...).

## [0.0.20] - 2026-11-18

### Added

- **Config** bar at the top of both views: saves the calculator and the structure decoder together under a label, in `.vscode/<label>.bc` (plain JSON) of the first workspace folder. The list loads a configuration in both views, **Delete** (click twice) moves its file to the trash; files added or removed by hand are picked up.

## [0.0.19] - 2026-11-18

### Fixed

- Struct Decoder: writing a value in the DEC column (`Enter`, `Tab`, picking an enumerator with the arrows) rebuilt the table and sent the focus back to the top of the page. The focus now stays on the field, and `Tab` / `Shift+Tab` (or `↓` / `↑` in a text field) go straight to the DEC field of the next or previous row. A refused value keeps the focus.

## [0.0.18] - 2026-11-18

### Added

- Struct Decoder: **Markdown** button next to the summary, copies the field table (Word, Bit min, Bit max, Bits, Field, Type, DEC, HEX, OCT, BIN) as a Markdown table under a line giving the structure, its From layout and its size.

### Fixed

- Readme: removed a duplicated block and the old layout rules left by 0.0.17; changelog entries 0.0.13 to 0.0.17 restored.

## [0.0.17] - 2026-11-18

### Changed

- Struct Decoder: the structure is laid out as in an interface control document, in absolute terms, with no compiler rule. The message is a sequence of words (**Word**: 8, 16, 32 or 64 bits, 32 by default); fields follow each other bit by bit inside the current word whatever their type, a field that does not fit starts the next word, a nested structure starts a word and fills whole words, `: 0` moves to the next word.

### Removed

- Struct Decoder: the Natural / Packed alignment and the "Offset in" choice; `#pragma pack` and packed attributes no longer change anything.

## [0.0.16] - 2026-11-18

### Changed

- Struct Decoder: a field spanning words shows the word range with its bits relative to itself, 0 to width - 1.

## [0.0.15] - 2026-11-18

### Changed

- Struct Decoder: Bit min / Bit max restart at 0 with each word: bit 31 of word 0 is followed by bit 0 of word 1.

## [0.0.14] - 2026-11-18

### Changed

- Struct Decoder: Bit min / Bit max counted from the start of the structure in allocation order (first byte: bits 0 to 7, second: 8 to 15...).

## [0.0.13] - 2026-11-18

### Added

- Struct Decoder: **Format** chooses how both buffers are shown, typed and copied: bytes (`FA 00` or `0xFA, 0x00`) or 16, 32 or 64-bit words (`0xFA00`...) read in the byte order of each layout. The copy buttons copy in that format, as text or as a C array.

## [0.0.12] - 2026-11-18

### Added

- Struct Decoder: "Offset in" chooses 32-bit (default), 16-bit or 64-bit words, bytes or storage units. With words or bytes, the first column is the word number and Bit min / Bit max the bits of the field inside that word read in the From layout; a field spanning words shows the word range.

## [0.0.11] - 2026-11-18

### Added

- Struct Decoder alignment: Natural (the C rules, now the default) or Packed in the toolbar, overridden by `#pragma pack(N)` (push, pop, reset) and `__attribute__((packed))` in the declarations, nested structures keeping their own pack. Padding bytes show as (padding) rows, the summary gives the alignment. Other preprocessor lines are ignored, and the formatter and the highlighting keep them.

### Changed

- Struct Decoder: structures are naturally aligned by default; they were always packed before. Choose Packed in the toolbar or add `#pragma pack(1)` for the previous layout.

## [0.0.10] - 2026-11-18

### Fixed

- Struct Decoder: an enum bitfield whose top bit is set was read as negative (a 1 bit enum holding 1 showed -1 (no enumerator)). An enum field is now signed only when the enum has a negative enumerator.

## [0.0.9] - 2026-11-18

### Changed

- Struct Decoder field table: Bit min, Bit max and Bits columns instead of a single Bits column; Offset only gives the byte.

## [0.0.8] - 2026-11-18

### Changed

- Struct Decoder layout, from top to bottom: the declarations (full width), the field table, then a "Data of <structure>" section with the From bytes and their offset, the To bytes under them, each with its copy buttons, and the byte by byte comparison.

## [0.0.7] - 2026-11-18

### Added

- Struct Decoder: enum fields are edited with a combo box listing the enumerators as NAME (value); a value matching no enumerator is shown as such, and Other value… switches to typing a number or an expression.

## [0.0.6] - 2026-11-18

### Added

- Struct Decoder: the converted buffer (To layout) is shown under the buffer (From layout), each labelled with its layout. It can be edited: the From buffer is rewritten through the reverse conversion.

## [0.0.5] - 2026-11-18

### Added

- Calculator: From and To layouts (LE/BE, LSB0/MSB0) like the Struct Decoder. The value converted to the To layout is shown in hex, decimal, octal and binary with copy buttons, and the memory of both is compared byte by byte. Each bit keeps its number: LSB0 to MSB0 reverses the bits of the word, LE to BE reverses its bytes. ⇄ swaps the layouts and replaces the value by its conversion.

## [0.0.4] - 2026-11-18

### Added

- Struct Decoder: typedef aliases (`typedef uint32_t t_date;`) of scalar, enum and structure types, aliases of aliases included, usable before or after their declaration; array typedefs are refused.

## [0.0.3] - 2026-11-18

### Added

- Struct Decoder: Format button (Shift+Alt+F) that indents the declarations and aligns types, names, bit widths, enumerator values and trailing comments; Ctrl+Z undoes it, and text that cannot be formatted without changing it is left untouched.
- Struct Decoder: syntax highlighting of the declarations (keywords, types, declared structures and enums, enumerators, numbers, comments), lines with an error underlined.

## [0.0.2] - 2026-11-18

### Added

- Struct Decoder conversion: From and To layouts (LE/BE, LSB0/MSB0), byte by byte comparison of the buffer and its conversion, copy as hex or C array, swap of the two layouts.
- Struct Decoder value editing: the DEC column takes values and expressions and rewrites the buffer.
- Enums (with underlying type, implicit values and expressions using earlier enumerators) and nested structures, arrays of structures included; the last structure is decoded, a list picks another one; enum values shown and typed by name.
- Enum and nested structures template.
- Types float32 and float64.
- Extension icon.

### Changed

- Word size, signed mode, byte order and bit numbering chosen in the views are saved with their content in the extension global state and restored after a restart; the settings only give the starting values.

## [0.0.1] - 2026-11-18

### Added

- BitCalc tab in the bottom panel, with a Calculator view and a Struct Decoder view.
- Calculator: 8 to 128 bit words, signed or unsigned, HEX / DEC / OCT / BIN fields kept in sync, clickable bits with LSB0 or MSB0 numbering, memory bytes in little or big endian, NOT, NEG, shifts, rotations, byte swap, and integer expressions with C precedence.
- Struct Decoder: C structure definitions with bitfields, arrays and padding, decoding of a hex buffer in little or big endian with LSB0 or MSB0 bitfield allocation, each field shown in decimal, hex, octal and binary.
- Struct Decoder templates: empty structure, bitfields example, IPv4 and UDP headers, RGB565 pixel, IEEE 754 float and double fields.
- Struct Decoder help (? button): supported types, syntax, layout rules and buffer formats.
- Editor commands: Evaluate Selection in Calculator, Decode Selection as Buffer, Use Selection as Structure.
- Settings for the initial word size, signed mode, byte order and bit numbering.
