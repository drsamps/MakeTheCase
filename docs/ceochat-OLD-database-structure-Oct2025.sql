-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.admins (
  id uuid NOT NULL,
  who text,
  CONSTRAINT admins_pkey PRIMARY KEY (id),
  CONSTRAINT admins_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id)
);
CREATE TABLE public.evaluations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  student_id uuid NOT NULL,
  score integer NOT NULL,
  summary text,
  criteria jsonb,
  persona text,
  hints integer DEFAULT 0,
  helpful real,
  liked text,
  improve text,
  chat_model text,
  super_model text,
  transcript text,
  CONSTRAINT evaluations_pkey PRIMARY KEY (id),
  CONSTRAINT evaluations_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id),
  CONSTRAINT evaluations_chat_model_fkey FOREIGN KEY (chat_model) REFERENCES public.models(model_id),
  CONSTRAINT evaluations_super_model_fkey FOREIGN KEY (super_model) REFERENCES public.models(model_id)
);
CREATE TABLE public.models (
  model_id text NOT NULL,
  model_name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  default boolean NOT NULL DEFAULT false,
  input_cost numeric,
  output_cost numeric,
  CONSTRAINT models_pkey PRIMARY KEY (model_id)
);
CREATE TABLE public.sections (
  section_id text NOT NULL CHECK (char_length(section_id) <= 20),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  section_title text NOT NULL,
  year_term text,
  enabled boolean NOT NULL DEFAULT true,
  chat_model text,
  super_model text,
  CONSTRAINT sections_pkey PRIMARY KEY (section_id),
  CONSTRAINT sections_chat_model_fkey FOREIGN KEY (chat_model) REFERENCES public.models(model_id),
  CONSTRAINT sections_super_model_fkey FOREIGN KEY (super_model) REFERENCES public.models(model_id)
);
CREATE TABLE public.students (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  first_name text NOT NULL,
  last_name text NOT NULL,
  full_name text NOT NULL,
  persona text,
  section_id text,
  finished_at timestamp with time zone,
  CONSTRAINT students_pkey PRIMARY KEY (id)
);