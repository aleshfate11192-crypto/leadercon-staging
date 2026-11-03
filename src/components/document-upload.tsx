
"use client";

import { useRef, useState } from "react";
import { useWorkspace } from "@/components/workspace-provider";
import { leaderConFileMimeType, validateLeaderConFile } from "@/lib/document-files";
import { supabase } from "@/lib/supabase";

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const BUCKET_NAME = "sumanik-documents";

type DocumentUploadProps = {
  vendorId: string;
  transactionId?: string;
  documentType?: "invoice" | "challan" | "receipt" | "payment_proof" | "credit_note" | "other";
  onUploaded?: () => void;
};

export default function DocumentUpload({
  vendorId,
  transactionId,
  documentType = "other",
  onUploaded,
}: DocumentUploadProps) {
  const { organization, user } = useWorkspace();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  function validateFile(file: File) {
    return validateLeaderConFile(file, MAX_FILE_SIZE);
  }

  async function handleUpload() {
    if (!organization || !user || !["owner", "accountant", "project_manager", "site_engineer"].includes(organization.role)) {
      setMessage("Your workspace role cannot upload vendor documents.");
      return;
    }
    if (!selectedFile) {
      setMessage("Please select a file first.");
      return;
    }

    const validationError = validateFile(selectedFile);

    if (validationError) {
      setMessage(validationError);
      return;
    }

    setUploading(true);
    setMessage("");

    try {
      const { data: sessionData, error: authError } = await supabase.auth.getSession();
      if (authError || !sessionData.session?.user || sessionData.session.user.id !== user.id) {
        setMessage("Please sign in again before uploading.");
        return;
      }

      const safeName = selectedFile.name
        .normalize("NFKD")
        .replace(/[^a-zA-Z0-9._-]/g, "_")
        .slice(-120);
      const mimeType = leaderConFileMimeType(selectedFile);
      if (!mimeType) throw new Error("Unsupported file type.");

      const storagePath = `${organization.id}/${user.id}/${crypto.randomUUID()}-${safeName}`;

      const { error: storageError } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(storagePath, selectedFile, {
          contentType: mimeType,
          upsert: false,
        });

      if (storageError) {
        throw storageError;
      }

      const { error: databaseError } = await supabase
        .from("documents")
        .insert({
          organization_id: organization.id,
          uploader_id: user.id,
          vendor_id: vendorId,
          transaction_id: transactionId ?? null,
          document_type: documentType,
          file_name: selectedFile.name,
          storage_path: storagePath,
          mime_type: mimeType,
          file_size_bytes: selectedFile.size,
          status: "uploaded",
        });

      if (databaseError) {
        await supabase.storage.from(BUCKET_NAME).remove([storagePath]);
        throw databaseError;
      }

      setSelectedFile(null);

      if (inputRef.current) {
        inputRef.current.value = "";
      }

      setMessage("Document uploaded successfully.");
      onUploaded?.();
    } catch (error) {
      console.error("Document upload failed:", error);
      setMessage(
        error instanceof Error
          ? `Upload failed: ${error.message}`
          : "Upload failed. Please try again."
      );
    } finally {
      setUploading(false);
    }
  }

  if (!["owner", "accountant", "project_manager", "site_engineer"].includes(organization?.role || "")) return null;

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div>
        <h3 className="text-base font-semibold text-slate-900">
          Upload document
        </h3>
        <p className="mt-1 text-sm text-slate-500">
          PNG, JPG, PDF, Excel, Word, CSV or text. Maximum 20 MB per file.
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".png,.jpg,.jpeg,.pdf,.xls,.xlsx,.doc,.docx,.csv,.txt,image/png,image/jpeg,application/pdf"
        disabled={uploading}
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null;
          setSelectedFile(file);
          setMessage(file ? validateFile(file) : "");
        }}
        className="block w-full text-sm text-slate-700 file:mr-4 file:rounded-lg file:border-0 file:bg-slate-100 file:px-4 file:py-2 file:font-medium"
      />

      {selectedFile && (
        <p className="break-all text-sm text-slate-600">
          Selected: {selectedFile.name} (
          {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB)
        </p>
      )}

      {message && (
        <p
          role="status"
          aria-live="polite"
          className="text-sm text-slate-700"
        >
          {message}
        </p>
      )}

      <button
        type="button"
        onClick={handleUpload}
        disabled={uploading || !selectedFile || Boolean(validateFile(selectedFile))}
        className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {uploading ? "Uploading..." : "Upload document"}
      </button>
    </section>
  );
}
