package team.acg.access.assets.asset;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.idanchuang.ecp.api.common.model.directory.EcpUserProfile;
import com.idanchuang.ecp.sdk.client.exception.EcpPermissionDeniedException;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import team.acg.access.assets.ecp.EcpDirectoryUserService;
import team.acg.access.assets.ecp.EcpSecurityPolicy;
import team.acg.access.assets.ecp.EcpSelectableDirectoryService;

import java.util.ArrayList;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Locale;
import java.util.Set;

@Service
public class AssetPartyResolver {
    static final String PUBLIC_AREA_SUBJECT = "asset:public-area";
    static final String LEGACY_OWNER_SUBJECT_PREFIX = "asset:legacy-owner:";
    private final ObjectProvider<EcpDirectoryUserService> directoryUsers;
    private final ObjectProvider<EcpSelectableDirectoryService> selectableDirectory;
    private final EcpSecurityPolicy securityPolicy;

    public AssetPartyResolver(ObjectProvider<EcpDirectoryUserService> directoryUsers,
                              ObjectProvider<EcpSelectableDirectoryService> selectableDirectory,
                              EcpSecurityPolicy securityPolicy) {
        this.directoryUsers = directoryUsers;
        this.selectableDirectory = selectableDirectory;
        this.securityPolicy = securityPolicy;
    }

    public JsonNode normalizeDraft(JsonNode draft) {
        if (draft == null || !draft.isObject()) return draft;
        ObjectNode normalized = (ObjectNode) draft.deepCopy();
        String owner = normalized.path("owner").asText("").trim();
        if (owner.isEmpty() || "未分配".equals(owner)) {
            normalized.put("owner", "未分配");
            normalized.put("ownerSubject", "");
            return normalized;
        }
        normalizeParty(normalized, "ownerSubject", "owner");
        return normalized;
    }

    public List<JsonNode> normalizeReplacementDrafts(List<JsonNode> drafts, String authorization) {
        if (drafts == null) return null;
        List<ObjectNode> normalized = new ArrayList<>();
        Set<String> namesToResolve = new LinkedHashSet<>();
        Set<String> emailsToResolve = new LinkedHashSet<>();
        for (JsonNode draft : drafts) {
            if (draft == null || !draft.isObject()) {
                throw new IllegalArgumentException("Every replacement asset must be an object");
            }
            ObjectNode item = (ObjectNode) draft.deepCopy();
            String owner = item.path("owner").asText("").trim();
            if (owner.isEmpty() || "未分配".equals(owner)) {
                item.put("owner", "未分配");
                item.put("ownerSubject", "");
            } else if (item.path("ownerSubject").asText("").isBlank()) {
                String email = normalizedEmail(item.path("email").asText(""));
                if (email.isBlank()) namesToResolve.add(owner);
                else emailsToResolve.add(email);
            }
            normalized.add(item);
        }
        if (!namesToResolve.isEmpty() || !emailsToResolve.isEmpty()) {
            if (securityPolicy.testBypassEnabled()) {
                throw new IllegalArgumentException("Replacement assets with owners require ECP directory validation");
            }
            if (!securityPolicy.enabled()) {
                throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "ECP directory validation is unavailable");
            }
            EcpDirectoryUserService service = directoryUsers.getIfAvailable();
            if (service == null) {
                throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "ECP directory validation is unavailable");
            }
            Map<String, EcpDirectoryUserService.DirectoryParty> partiesByName;
            Map<String, EcpDirectoryUserService.DirectoryParty> partiesByEmail;
            try {
                partiesByName = namesToResolve.isEmpty() ? Map.of() : service.requireByNames(namesToResolve);
                partiesByEmail = emailsToResolve.isEmpty() ? Map.of() : service.requireByEmails(emailsToResolve);
            } catch (EcpPermissionDeniedException denied) {
                EcpSelectableDirectoryService selectable = selectableDirectory.getIfAvailable();
                if (selectable == null) throw denied;
                List<EcpUserProfile> candidates = new ArrayList<>(selectable.snapshot(authorization).users());
                Set<String> unresolvedNames = service.namesWithoutUniqueMatch(namesToResolve, candidates);
                if (!unresolvedNames.isEmpty()) {
                    candidates.removeIf(profile -> unresolvedNames.contains(profile.name() == null ? "" : profile.name().trim()));
                    candidates.addAll(selectable.exactNameMatches(unresolvedNames, authorization));
                }
                Set<String> unresolvedEmails = service.emailsWithoutUniqueMatch(emailsToResolve, candidates);
                if (!unresolvedEmails.isEmpty()) {
                    candidates.removeIf(profile -> unresolvedEmails.contains(normalizedEmail(profile.email())));
                    candidates.addAll(selectable.exactEmailMatches(unresolvedEmails, authorization));
                }
                Set<String> unresolvedAfterSearch = service.namesWithoutUniqueMatch(namesToResolve, candidates);
                Set<String> unresolvedEmailsAfterSearch = service.emailsWithoutUniqueMatch(emailsToResolve, candidates);
                if (!unresolvedEmailsAfterSearch.isEmpty()) {
                    throw new IllegalArgumentException("电子邮箱无法唯一匹配 ECP 账号目录："
                        + String.join("、", unresolvedEmailsAfterSearch));
                }
                Set<String> resolvedNames = new LinkedHashSet<>(namesToResolve);
                resolvedNames.removeAll(unresolvedAfterSearch);
                Map<String, EcpDirectoryUserService.DirectoryParty> selectableParties = new LinkedHashMap<>();
                if (!resolvedNames.isEmpty()) {
                    selectableParties.putAll(service.requireByNames(resolvedNames, candidates));
                }
                unresolvedAfterSearch.forEach(name -> selectableParties.put(name,
                    new EcpDirectoryUserService.DirectoryParty(legacyOwnerSubject(name), name, "", "", "", "")));
                partiesByName = Map.copyOf(selectableParties);
                partiesByEmail = emailsToResolve.isEmpty()
                    ? Map.of() : service.requireByEmails(emailsToResolve, candidates);
            }
            Map<String, EcpDirectoryUserService.DirectoryParty> resolvedPartiesByName = partiesByName;
            Map<String, EcpDirectoryUserService.DirectoryParty> resolvedPartiesByEmail = partiesByEmail;
            normalized.forEach(item -> {
                String owner = item.path("owner").asText("").trim();
                String email = normalizedEmail(item.path("email").asText(""));
                EcpDirectoryUserService.DirectoryParty party = email.isBlank()
                    ? resolvedPartiesByName.get(owner) : resolvedPartiesByEmail.get(email);
                if (party != null) {
                    if (!email.isBlank() && !owner.equals(party.name())) {
                        throw new IllegalArgumentException("电子邮箱“" + email + "”对应的 ECP 姓名与使用人“" + owner + "”不一致");
                    }
                    applyParty(item, "ownerSubject", "owner", party);
                }
            });
        }
        return normalized.stream().map(JsonNode.class::cast).toList();
    }

    public void normalizeCommand(String action, ObjectNode fields) {
        switch (action) {
            case "receive" -> normalizeParty(fields, "receiverSubject", "receiver");
            case "receive-import" -> normalizeImportOperations(fields, "receive");
            case "update-import" -> normalizeImportOperations(fields, "edit");
            case "borrow" -> normalizeParty(fields, "borrowerSubject", "borrower");
            case "handover" -> {
                if ("公共交接".equals(fields.path("handoverType").asText())) {
                    fields.put("receiver", "公共区域");
                    fields.put("receiverSubject", PUBLIC_AREA_SUBJECT);
                    fields.put("departmentUnionId", "");
                } else {
                    normalizeParty(fields, "receiverSubject", "receiver");
                }
            }
            case "edit", "batch-edit" -> {
                if (fields.has("owner")) {
                    String owner = fields.path("owner").asText("").trim();
                    if (owner.isEmpty() || "未分配".equals(owner)) {
                        fields.put("owner", "未分配");
                        fields.put("ownerSubject", "");
                    } else {
                        normalizeParty(fields, "ownerSubject", "owner");
                    }
                }
            }
            default -> {
                // This command does not assign an asset to a person.
            }
        }
    }

    private void normalizeImportOperations(ObjectNode fields, String itemAction) {
        JsonNode operations = fields.get("operations");
        if (operations == null || !operations.isObject()) return;
        operations.fields().forEachRemaining(entry -> {
            if (entry.getValue().isObject()) normalizeCommand(itemAction, (ObjectNode) entry.getValue());
        });
    }

    private void normalizeParty(ObjectNode target, String subjectField, String nameField) {
        if (securityPolicy.testBypassEnabled()) return;
        if (!securityPolicy.enabled()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "ECP directory validation is unavailable");
        }
        EcpDirectoryUserService service = directoryUsers.getIfAvailable();
        if (service == null) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "ECP directory validation is unavailable");
        }
        EcpDirectoryUserService.DirectoryParty party = service.requireBySubject(target.path(subjectField).asText());
        applyParty(target, subjectField, nameField, party);
    }

    private void applyParty(ObjectNode target, String subjectField, String nameField,
                            EcpDirectoryUserService.DirectoryParty party) {
        target.put(subjectField, party.subject());
        target.put(nameField, party.name());
        target.put("departmentUnionId", party.departmentUnionId());
        target.put("department", party.department());
        target.put("companyUnionId", party.companyUnionId());
        target.put("company", party.company());
    }

    private String legacyOwnerSubject(String name) {
        return LEGACY_OWNER_SUBJECT_PREFIX
            + java.util.UUID.nameUUIDFromBytes(name.getBytes(StandardCharsets.UTF_8));
    }

    private String normalizedEmail(String value) {
        return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
    }
}
