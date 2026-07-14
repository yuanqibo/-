package team.acg.access.assets.asset;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import team.acg.access.assets.ecp.EcpDirectoryUserService;
import team.acg.access.assets.ecp.EcpSecurityPolicy;

@Service
public class AssetPartyResolver {
    static final String PUBLIC_AREA_SUBJECT = "asset:public-area";
    private final ObjectProvider<EcpDirectoryUserService> directoryUsers;
    private final EcpSecurityPolicy securityPolicy;

    public AssetPartyResolver(ObjectProvider<EcpDirectoryUserService> directoryUsers,
                              EcpSecurityPolicy securityPolicy) {
        this.directoryUsers = directoryUsers;
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
        target.put(subjectField, party.subject());
        target.put(nameField, party.name());
        target.put("departmentUnionId", party.departmentUnionId());
        target.put("department", party.department());
        target.put("companyUnionId", party.companyUnionId());
        target.put("company", party.company());
    }
}
