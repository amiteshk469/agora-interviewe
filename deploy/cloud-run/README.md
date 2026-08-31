# Cloud Run service

The FastAPI image is built from the `apps/api` context with `deploy/cloud-run/Dockerfile`. It listens on Cloud Run's injected `PORT`, runs as a non-root user, and contains no source-tree environment files.

## One-time provisioning

1. Create an Artifact Registry Docker repository named `roundcraft` in `asia-south1`.
2. Create the `roundcraft-api` runtime service account and grant it access only to the Secret Manager entries referenced by `service.template.yaml`.
3. Build and push an initial image tagged `bootstrap` using the same Docker command as the release workflow.
4. Copy `service.template.yaml` to `/tmp/roundcraft-service.yaml`. Replace both `PROJECT_ID` placeholders and the example CORS origin.
5. Replace `https://REPLACE_WITH_PUBLIC_API_HOST/llm/chat/completions` with the stable public API origin plus the exact `/llm/chat/completions` path. It cannot be a Vercel or localhost URL. If this is the first Cloud Run creation and its generated `run.app` URL does not exist yet, use `https://bootstrap.invalid/llm/chat/completions` only for the initial create, then complete step 8 before any release.
6. Reject an incomplete rendering before provisioning:

   ```bash
   if grep -Eq 'PROJECT_ID|REPLACE_WITH_PUBLIC_API_HOST|roundcraft\.example' /tmp/roundcraft-service.yaml; then
     echo "Cloud Run template still contains placeholders" >&2
     exit 1
   fi
   ```

7. Create the referenced secrets, then apply the rendered file:

   ```bash
   gcloud run services replace /tmp/roundcraft-service.yaml --region asia-south1
   ```

8. If step 5 used the bootstrap URL, replace it immediately with Cloud Run's generated public origin:

   ```bash
   service_url="$(gcloud run services describe roundcraft-api --region asia-south1 --format='value(status.url)')"
   gcloud run services update roundcraft-api \
     --region asia-south1 \
     --update-env-vars="AGORA_CUSTOM_LLM_URL=${service_url}/llm/chat/completions"
   ```

9. Allow Agora to reach the authenticated callback endpoints:

   ```bash
   gcloud run services add-iam-policy-binding roundcraft-api \
     --region asia-south1 \
     --member=allUsers \
     --role=roles/run.invoker
   ```

10. Confirm Cloud Run retained the exact callback value:

   ```bash
   configured_llm_url="$(gcloud run services describe roundcraft-api \
     --region asia-south1 \
     --format='value(spec.template.spec.containers[0].env[?name="AGORA_CUSTOM_LLM_URL"].value)')"
   case "$configured_llm_url" in
     https://*/llm/chat/completions) ;;
     *) echo "Invalid AGORA_CUSTOM_LLM_URL: $configured_llm_url" >&2; exit 1 ;;
   esac
   case "$configured_llm_url" in
     *REPLACE*|*.example*|*.invalid*|*localhost*|*127.0.0.1*) echo "AGORA_CUSTOM_LLM_URL is not public" >&2; exit 1 ;;
   esac
   ```

   The production workflow repeats this validation before every release.

Public invocation is required because Agora calls the custom LLM and webhook endpoints over HTTPS. The application still authenticates those endpoints with their dedicated bearer/HMAC credentials.

Web search is disabled in the template. When enabling it, add `WEB_SEARCH_API_KEY` as a Secret Manager-backed environment variable; do not render it as plain YAML.

The production workflow updates only the image. It leaves runtime configuration and Secret Manager bindings untouched, deploys a tagged zero-traffic revision, checks `/health/live` and `/health/ready`, then moves traffic to the verified tag.
