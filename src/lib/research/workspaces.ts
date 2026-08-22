import { supabase } from "@/lib/supabase/client";
import type { Workspace } from "@/types/database";

export async function listWorkspaces(): Promise<Workspace[]> {
  const { data, error } = await supabase
    .from("workspaces")
    .select("id, name, created_at")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Could not load workspaces: ${error.message}`);
  return data as Workspace[];
}

export async function getWorkspace(id: string): Promise<Workspace | null> {
  const { data, error } = await supabase
    .from("workspaces")
    .select("id, name, created_at")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`Could not load workspace: ${error.message}`);
  return data as Workspace | null;
}

export async function createWorkspace(name: string): Promise<Workspace> {
  const normalizedName = name.trim();
  if (!normalizedName) throw new Error("Workspace name cannot be empty.");

  const { data, error } = await supabase
    .from("workspaces")
    .insert({ name: normalizedName })
    .select("id, name, created_at")
    .single();

  if (error) throw new Error(`Could not create workspace: ${error.message}`);
  return data as Workspace;
}

