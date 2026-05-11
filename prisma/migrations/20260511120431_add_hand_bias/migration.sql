-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Room" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'WAITING',
    "mode" TEXT NOT NULL DEFAULT 'TRADITIONAL',
    "maxPlayers" INTEGER NOT NULL DEFAULT 4,
    "isPrivate" BOOLEAN NOT NULL DEFAULT true,
    "handBias" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "endedAt" DATETIME
);
INSERT INTO "new_Room" ("code", "createdAt", "endedAt", "hostId", "id", "isPrivate", "maxPlayers", "mode", "startedAt", "status") SELECT "code", "createdAt", "endedAt", "hostId", "id", "isPrivate", "maxPlayers", "mode", "startedAt", "status" FROM "Room";
DROP TABLE "Room";
ALTER TABLE "new_Room" RENAME TO "Room";
CREATE UNIQUE INDEX "Room_code_key" ON "Room"("code");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
