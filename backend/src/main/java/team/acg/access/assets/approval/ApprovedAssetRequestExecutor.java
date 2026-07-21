package team.acg.access.assets.approval;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Service;
import team.acg.access.assets.asset.AssetPartyResolver;
import team.acg.access.assets.asset.AssetService;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

@Service
public class ApprovedAssetRequestExecutor {
    private static final Set<String> SUPPORTED_TYPES = Set.of(
        "资产领用", "资产借用", "资产归还", "资产退还", "资产交接");
    private final AssetService assetService;
    private final AssetPartyResolver assetPartyResolver;
    private final ObjectMapper mapper;

    public ApprovedAssetRequestExecutor(AssetService assetService, AssetPartyResolver assetPartyResolver,
                                        ObjectMapper mapper) {
        this.assetService = assetService;
        this.assetPartyResolver = assetPartyResolver;
        this.mapper = mapper;
    }

    public boolean supports(String requestType) {
        return SUPPORTED_TYPES.contains(requestType);
    }

    public void execute(ObjectNode item, Operator operator) {
        String action = switch (item.path("type").asText()) {
            case "资产领用" -> "receive";
            case "资产借用" -> "borrow";
            case "资产归还" -> "borrow-return";
            case "资产退还" -> "return";
            case "资产交接" -> "handover";
            default -> throw new IllegalArgumentException(
                "Unsupported executable request type: " + item.path("type").asText());
        };
        ObjectNode fields = mapper.createObjectNode();
        List<String> assetIds = requestAssetIds(item);
        fields.put("operator", operator.name());
        fields.put("operatorAccount", operator.account());
        fields.put("operatorSubject", operator.subject());
        fields.put("note", item.path("reason").asText(""));
        fields.put("company", item.path("company").asText(""));
        fields.put("department", item.path("department").asText(""));
        switch (action) {
            case "receive" -> {
                fields.put("receiver", item.path("applicant").asText());
                fields.put("receiverSubject", requiredField(item, "applicantDirectorySubject"));
                fields.put("location", requiredField(item, "receiveLocation"));
                fields.put("date", requestDate(item, "receiveDate"));
            }
            case "borrow" -> {
                fields.put("borrower", item.path("applicant").asText());
                fields.put("borrowerSubject", requiredField(item, "applicantDirectorySubject"));
                fields.put("location", requiredField(item, "borrowLocation"));
                fields.put("date", requestDate(item, "borrowDate"));
                fields.put("expectedReturnDate", requiredField(item, "expectedReturnDate"));
            }
            case "borrow-return", "return" -> {
                assetService.requireOwnedForApprovedRequest(assetIds,
                    requiredField(item, "applicantDirectorySubject"),
                    "borrow-return".equals(action) ? Set.of("借用中") : Set.of("在用"));
                fields.put("location", requiredField(item, "returnLocation"));
                fields.put("date", requestDate(item, "returnDate"));
            }
            case "handover" -> {
                assetService.requireOwnedForApprovedRequest(assetIds,
                    requiredField(item, "applicantDirectorySubject"), Set.of("在用", "借用中"));
                String handoverType = item.path("handoverType").asText("员工交接");
                if (!"公共交接".equals(handoverType)) {
                    fields.put("receiverSubject", requiredField(item, "receiverSubject"));
                }
                fields.put("location", requiredField(item, "handoverLocation"));
                fields.put("date", requestDate(item, "handoverDate"));
                fields.put("handoverType", handoverType);
            }
            default -> throw new IllegalStateException("Unsupported asset action: " + action);
        }
        assetPartyResolver.normalizeCommand(action, fields);
        assetService.execute(action, assetIds, fields);
    }

    private List<String> requestAssetIds(JsonNode item) {
        JsonNode values = item.path("assetIds");
        if (!values.isArray() || values.isEmpty() || values.size() > 100) {
            throw new IllegalArgumentException("Executable request must contain between 1 and 100 asset ids");
        }
        List<String> ids = new ArrayList<>();
        values.forEach(value -> {
            String id = value.asText("").trim();
            if (id.isEmpty() || ids.contains(id)) {
                throw new IllegalArgumentException("Executable request contains invalid asset ids");
            }
            ids.add(id);
        });
        return List.copyOf(ids);
    }

    private String requestDate(JsonNode item, String field) {
        String value = item.path(field).asText("").trim();
        return value.isEmpty() ? LocalDate.now().toString() : LocalDate.parse(value).toString();
    }

    private String requiredField(JsonNode item, String field) {
        String value = item.path(field).asText("").trim();
        if (value.isEmpty()) throw new IllegalArgumentException("Executable request field is required: " + field);
        return value;
    }

    public record Operator(String name, String account, String subject, String identitySubject) {
        public Operator {
            name = text(name);
            account = text(account);
            subject = text(subject);
            identitySubject = text(identitySubject);
            if (name.isEmpty()) name = "ECP审批";
        }

        public Operator(String name, String account, String subject) {
            this(name, account, subject, subject);
        }

        public static Operator ecp() {
            return new Operator("ECP审批", "ecp-approval", "ecp-approval", "ecp-approval");
        }

        private static String text(String value) {
            return value == null ? "" : value.trim();
        }
    }
}
