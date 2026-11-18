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
    uint32_t field;
};`
  },
  {
    label: "Bitfields example",
    definition: `struct Header {
    uint8_t  version : 4;
    uint8_t  length  : 4;
    uint8_t          : 3;   // reserved
    uint8_t  flags   : 5;
    uint16_t id;
    float    gain;
};`
  },
  {
    label: "IPv4 header (BE, MSB0)",
    endianness: "big",
    bitOrder: "msb0",
    definition: `// Network byte order: big endian, bitfields from the MSB
struct Ipv4Header {
    uint8_t  version         : 4;
    uint8_t  ihl             : 4;
    uint8_t  dscp            : 6;
    uint8_t  ecn             : 2;
    uint16_t total_length;
    uint16_t identification;
    uint16_t flags           : 3;
    uint16_t fragment_offset : 13;
    uint8_t  ttl;
    uint8_t  protocol;
    uint16_t checksum;
    uint8_t  source[4];
    uint8_t  destination[4];
};`
  },
  {
    label: "UDP header (BE)",
    endianness: "big",
    definition: `// Network byte order: big endian
struct UdpHeader {
    uint16_t source_port;
    uint16_t destination_port;
    uint16_t length;
    uint16_t checksum;
};`
  },
  {
    label: "RGB565 pixel (LSB0)",
    bitOrder: "lsb0",
    definition: `struct Rgb565 {
    uint16_t blue  : 5;
    uint16_t green : 6;
    uint16_t red   : 5;
};`
  },
  {
    label: "IEEE 754 float bits (LSB0)",
    bitOrder: "lsb0",
    definition: `// Single precision float split in its fields
struct Float32Bits {
    uint32_t mantissa : 23;
    uint32_t exponent : 8;
    uint32_t sign     : 1;
};`
  },
  {
    label: "IEEE 754 double bits (LSB0)",
    bitOrder: "lsb0",
    definition: `// Double precision float split in its fields
struct Float64Bits {
    uint64_t mantissa : 52;
    uint64_t exponent : 11;
    uint64_t sign     : 1;
};`
  }
];
