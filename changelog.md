# Change Log

All notable changes to the "BitCalc" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

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
