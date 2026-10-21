import type { BinaryLike, ScryptOptions } from "node:crypto";

declare module "crypto" {
  namespace scrypt {
    function __promisify__(
      password: BinaryLike,
      salt: BinaryLike,
      keylen: number,
      options?: ScryptOptions,
    ): Promise<Buffer>;
  }
}

declare module "node:crypto" {
  namespace scrypt {
    function __promisify__(
      password: BinaryLike,
      salt: BinaryLike,
      keylen: number,
      options?: ScryptOptions,
    ): Promise<Buffer>;
  }
}
