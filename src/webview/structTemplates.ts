import { BitOrder, Endianness } from "../utils/bits";

/// Structure templates offered by the Struct Decoder. A template may also set
/// the byte order and the bit numbering it is written for.
export interface IStructTemplate {
  readonly label: string;
  readonly definition: string;
  readonly endianness?: Endianness;
  readonly bitOrder?: BitOrder;
}

export const STRUCT_TEMPLATES: readonly IStructTemplate[] = [
  {
    label: "Empty structure",
    definition: `struct Name {
    uint32 field;
}`
  },
  {
    label: "Bitfields example",
    definition: `struct Header {
    uint8  version : 4;
    uint8  length  : 4;
    uint8          : 3; // reserved
    uint8  flags   : 5;
    uint16 id;
    float  gain;
}`
  },
  {
    label: "Enum and nested structures",
    definition: `// Typedefs and enums first, then the structures using them.
// The last structure is decoded; pick another one in the list above the table.
typedef uint32 t_date;

enum MsgType : uint8 {
    MSG_PING = 1,
    MSG_PONG,
    MSG_DATA = 0x10
}

struct Header {
    MsgType type;
    uint8   version : 4;
    uint8   flags   : 4;
    uint16  length;
}

struct Message {
    Header header;
    t_date date;
    uint8  payload[4];
}`
  },
  {
    label: "IPv4 header (BE, MSB0)",
    endianness: "big",
    bitOrder: "msb0",
    definition: `// Network byte order: big endian, bitfields from the MSB
struct Ipv4Header {
    uint8  version         : 4;
    uint8  ihl             : 4;
    uint8  dscp            : 6;
    uint8  ecn             : 2;
    uint16 total_length;
    uint16 identification;
    uint16 flags           : 3;
    uint16 fragment_offset : 13;
    uint8  ttl;
    uint8  protocol;
    uint16 checksum;
    uint8  source[4];
    uint8  destination[4];
}`
  },
  {
    label: "UDP header (BE)",
    endianness: "big",
    definition: `// Network byte order: big endian
struct UdpHeader {
    uint16 source_port;
    uint16 destination_port;
    uint16 length;
    uint16 checksum;
}`
  },
  {
    label: "RGB565 pixel (LSB0)",
    bitOrder: "lsb0",
    definition: `struct Rgb565 {
    uint16 blue  : 5;
    uint16 green : 6;
    uint16 red   : 5;
}`
  },
  {
    label: "IEEE 754 float bits (LSB0)",
    bitOrder: "lsb0",
    definition: `// Single precision float split in its fields
struct Float32Bits {
    uint32 mantissa : 23;
    uint32 exponent : 8;
    uint32 sign     : 1;
}`
  },
  {
    label: "IEEE 754 double bits (LSB0)",
    bitOrder: "lsb0",
    definition: `// Double precision float split in its fields
struct Float64Bits {
    uint64 mantissa : 52;
    uint64 exponent : 11;
    uint64 sign     : 1;
}`
  }
];
