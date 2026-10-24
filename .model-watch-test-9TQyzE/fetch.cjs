
        let calls = 0;
        global.fetch = async (url, options) => {
          if (options.method !== "GET") {
            console.error("UNEXPECTED CREATE");
            throw new Error("Unexpected create");
          }
          const cursor = new URL(url).searchParams.get("cursor");
          if (calls++ > 1 || cursor !== (calls === 1 ? null : "66709")) throw new Error("Unexpected cursor");
          const body = calls === 1
            ? { success: true, tasks: [{ title: "Fuzzy match" }], total: 3, nextCursor: "66709" }
            : {"success":true,"tasks":[],"total":3,"nextCursor":"66710"};
          const status = calls === 1 ? 200 : 200;
          return { ok: status < 400, status, json: async () => body };
        };
      