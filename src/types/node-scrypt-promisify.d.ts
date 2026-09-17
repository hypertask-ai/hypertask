import type { BinaryLike, ScryptOptions } from "node:crypto";

// promisify(scrypt) otherwise types as 3-arg only, so qaLogin.ts fails tsc.
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
