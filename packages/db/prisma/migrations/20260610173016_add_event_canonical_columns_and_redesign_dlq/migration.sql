/*
  Warnings:

  - Added the required column `eventType` to the `dlq_events` table without a default value. This is not possible if the table is not empty.
  - Added the required column `fingerprint` to the `dlq_events` table without a default value. This is not possible if the table is not empty.
  - Added the required column `source` to the `dlq_events` table without a default value. This is not possible if the table is not empty.
  - Added the required column `externalId` to the `events` table without a default value. This is not possible if the table is not empty.
  - Added the required column `occurredAt` to the `events` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "dlq_events" DROP CONSTRAINT "dlq_events_eventId_fkey";

-- DropIndex
DROP INDEX "dlq_events_eventId_key";

-- AlterTable
ALTER TABLE "dlq_events" ADD COLUMN     "errorStack" TEXT,
ADD COLUMN     "eventType" TEXT NOT NULL,
ADD COLUMN     "fingerprint" TEXT NOT NULL,
ADD COLUMN     "source" TEXT NOT NULL,
ALTER COLUMN "eventId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "externalId" TEXT NOT NULL,
ADD COLUMN     "occurredAt" TIMESTAMP(3) NOT NULL;

-- CreateIndex
CREATE INDEX "dlq_events_fingerprint_idx" ON "dlq_events"("fingerprint");
