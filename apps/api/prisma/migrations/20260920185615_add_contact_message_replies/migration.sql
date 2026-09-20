-- CreateTable
CREATE TABLE "contact_message_replies" (
    "id" TEXT NOT NULL,
    "contactMessageId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentByUserId" TEXT NOT NULL,
    "emailSentAt" TIMESTAMP(3),

    CONSTRAINT "contact_message_replies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contact_message_replies_contactMessageId_idx" ON "contact_message_replies"("contactMessageId");

-- AddForeignKey
ALTER TABLE "contact_message_replies" ADD CONSTRAINT "contact_message_replies_contactMessageId_fkey" FOREIGN KEY ("contactMessageId") REFERENCES "contact_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_message_replies" ADD CONSTRAINT "contact_message_replies_sentByUserId_fkey" FOREIGN KEY ("sentByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
