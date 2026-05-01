/* ─── Environment Configuration ─── */
const CONFIG = {
  OPENAI_API_KEY: localStorage.getItem('nutritrack_openai_key') || "",
  MODEL: "gpt-4o-mini",
  SUPABASE_URL: "https://kczpbqrjtefhxsvzmgqq.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtjenBicXJqdGVmaHhzdnptZ3FxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc2NDU4MTAsImV4cCI6MjA5MzIyMTgxMH0.JSY6Vl6B5rQUo5cXZGkwyaNtBu2_X2Vbv_YLOVBpmXM",
};
