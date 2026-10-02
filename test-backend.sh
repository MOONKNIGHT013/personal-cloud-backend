#!/bin/bash

BASE_URL="http://localhost:3000"
COOKIE_FILE="test-cookies.txt"
TEST_FOLDER="AutoTestFolder"
TEST_FILE="auto-test.txt"
RENAMED_FILE="auto-renamed.txt"
DOWNLOAD_FILE="auto-downloaded.txt"
ZIP_FILE="AutoTestFolder.zip"

PASS_COUNT=0
FAIL_COUNT=0


# ==========================================
# HELPER FUNCTIONS
# ==========================================

pass() {
    echo "[PASS] $1"
    PASS_COUNT=$((PASS_COUNT + 1))
}

fail() {
    echo "[FAIL] $1"
    FAIL_COUNT=$((FAIL_COUNT + 1))
}


cleanup() {
    rm -f "$COOKIE_FILE"
    rm -f "$TEST_FILE"
    rm -f "$DOWNLOAD_FILE"
    rm -f "$ZIP_FILE"
}


echo
echo "=========================================="
echo "      PERSONAL CLOUD BACKEND TEST"
echo "=========================================="
echo


# ==========================================
# CHECK SERVER
# ==========================================

if curl -fsS "$BASE_URL/api/health" >/dev/null 2>&1; then
    pass "Server /api/health"
else
    fail "Server /api/health"
    echo
    echo "Server is not reachable."
    echo "Make sure T11 is running: node server.js"
    exit 1
fi


# ==========================================
# LOGIN
# ==========================================

rm -f "$COOKIE_FILE"

USERNAME=$(grep '^CLOUD_USERNAME=' .env | cut -d= -f2-)
PASSWORD=$(grep '^CLOUD_PASSWORD=' .env | cut -d= -f2-)

LOGIN_RESPONSE=$(
    curl -fsS \
        -c "$COOKIE_FILE" \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"$USERNAME\",\"password\":\"$PASSWORD\"}" \
        "$BASE_URL/api/login"
)

if echo "$LOGIN_RESPONSE" | grep -q '"message":"Login successful"'; then
    pass "Login"
else
    fail "Login"
    echo "$LOGIN_RESPONSE"
    exit 1
fi


# ==========================================
# SESSION
# ==========================================

ME_RESPONSE=$(
    curl -fsS \
        -b "$COOKIE_FILE" \
        "$BASE_URL/api/me"
)

if echo "$ME_RESPONSE" | grep -q '"authenticated":true'; then
    pass "Session /api/me"
else
    fail "Session /api/me"
    echo "$ME_RESPONSE"
    exit 1
fi


# ==========================================
# FILE LISTING
# ==========================================

FILES_RESPONSE=$(
    curl -fsS \
        -b "$COOKIE_FILE" \
        "$BASE_URL/api/files"
)

if echo "$FILES_RESPONSE" | grep -q '"currentFolder":""'; then
    pass "Root file listing"
else
    fail "Root file listing"
    echo "$FILES_RESPONSE"
fi


# ==========================================
# CREATE TEST FOLDER
# ==========================================

# Remove old test folder if it exists
curl -sS \
    -b "$COOKIE_FILE" \
    -X DELETE \
    "$BASE_URL/api/files?path=$TEST_FOLDER" \
    >/dev/null 2>&1 || true


FOLDER_RESPONSE=$(
    curl -fsS \
        -b "$COOKIE_FILE" \
        -X POST \
        "$BASE_URL/api/folders?name=$TEST_FOLDER"
)

if echo "$FOLDER_RESPONSE" | grep -q '"message":"Folder created successfully"'; then
    pass "Create folder"
else
    fail "Create folder"
    echo "$FOLDER_RESPONSE"
    exit 1
fi


# ==========================================
# CREATE LOCAL TEST FILE
# ==========================================

echo "Personal Cloud automated test" > "$TEST_FILE"


# ==========================================
# UPLOAD
# ==========================================

UPLOAD_RESPONSE=$(
    curl -fsS \
        -b "$COOKIE_FILE" \
        -F "file=@$TEST_FILE" \
        "$BASE_URL/api/upload?folder=$TEST_FOLDER"
)

if echo "$UPLOAD_RESPONSE" | grep -q '"message":"File uploaded successfully"'; then
    pass "File upload"
else
    fail "File upload"
    echo "$UPLOAD_RESPONSE"
    exit 1
fi


# ==========================================
# VERIFY UPLOAD / LIST FOLDER
# ==========================================

FOLDER_LIST=$(
    curl -fsS \
        -b "$COOKIE_FILE" \
        "$BASE_URL/api/files?folder=$TEST_FOLDER"
)

if echo "$FOLDER_LIST" | grep -q "$TEST_FILE"; then
    pass "Uploaded file listing"
else
    fail "Uploaded file listing"
    echo "$FOLDER_LIST"
fi


# ==========================================
# DOWNLOAD
# ==========================================

if curl -fsS \
    -b "$COOKIE_FILE" \
    -o "$DOWNLOAD_FILE" \
    "$BASE_URL/api/download?file=$TEST_FOLDER/$TEST_FILE"; then

    pass "File download"
else
    fail "File download"
fi


# ==========================================
# VERIFY DOWNLOADED CONTENT
# ==========================================

if [ -f "$DOWNLOAD_FILE" ] &&
   cmp -s "$TEST_FILE" "$DOWNLOAD_FILE"; then

    pass "Downloaded content verification"
else
    fail "Downloaded content verification"
fi


# ==========================================
# RENAME
# ==========================================

RENAME_RESPONSE=$(
    curl -fsS \
        -b "$COOKIE_FILE" \
        -X PUT \
        "$BASE_URL/api/files?path=$TEST_FOLDER/$TEST_FILE&newName=$RENAMED_FILE"
)

if echo "$RENAME_RESPONSE" | grep -q '"message":"Renamed successfully"'; then
    pass "File rename"
else
    fail "File rename"
    echo "$RENAME_RESPONSE"
fi


# ==========================================
# VERIFY RENAMED FILE
# ==========================================

RENAMED_LIST=$(
    curl -fsS \
        -b "$COOKIE_FILE" \
        "$BASE_URL/api/files?folder=$TEST_FOLDER"
)

if echo "$RENAMED_LIST" | grep -q "$RENAMED_FILE"; then
    pass "Renamed file listing"
else
    fail "Renamed file listing"
    echo "$RENAMED_LIST"
fi


# ==========================================
# ZIP DOWNLOAD
# ==========================================

if curl -fsS \
    -b "$COOKIE_FILE" \
    -o "$ZIP_FILE" \
    "$BASE_URL/api/download-folder?folder=$TEST_FOLDER"; then

    pass "Folder ZIP download"
else
    fail "Folder ZIP download"
fi


# ==========================================
# ZIP CONTENT
# ==========================================

if command -v unzip >/dev/null 2>&1; then

    if unzip -l "$ZIP_FILE" 2>/dev/null | grep -q "$RENAMED_FILE"; then
        pass "ZIP content verification"
    else
        fail "ZIP content verification"
    fi

else

    echo "[SKIP] ZIP content verification - unzip not installed"

fi


# ==========================================
# DELETE FILE
# ==========================================

DELETE_RESPONSE=$(
    curl -fsS \
        -b "$COOKIE_FILE" \
        -X DELETE \
        "$BASE_URL/api/files?path=$TEST_FOLDER/$RENAMED_FILE"
)

if echo "$DELETE_RESPONSE" | grep -q '"message":"File deleted successfully"'; then
    pass "File delete"
else
    fail "File delete"
    echo "$DELETE_RESPONSE"
fi


# ==========================================
# VERIFY FILE DELETED
# ==========================================

AFTER_DELETE=$(
    curl -fsS \
        -b "$COOKIE_FILE" \
        "$BASE_URL/api/files?folder=$TEST_FOLDER"
)

if ! echo "$AFTER_DELETE" | grep -q "$RENAMED_FILE"; then
    pass "File deletion verification"
else
    fail "File deletion verification"
fi


# ==========================================
# UNAUTHENTICATED ACCESS TEST
# ==========================================

UNAUTH_STATUS=$(
    curl -sS \
        -o /dev/null \
        -w "%{http_code}" \
        "$BASE_URL/api/files"
)

if [ "$UNAUTH_STATUS" = "401" ]; then
    pass "Unauthenticated API protection"
else
    fail "Unauthenticated API protection (HTTP $UNAUTH_STATUS)"
fi


# ==========================================
# PATH TRAVERSAL TEST
# ==========================================

TRAVERSAL_STATUS=$(
    curl -sS \
        -o /dev/null \
        -w "%{http_code}" \
        -b "$COOKIE_FILE" \
        "$BASE_URL/api/download?file=../server.js"
)

if [ "$TRAVERSAL_STATUS" = "400" ] ||
   [ "$TRAVERSAL_STATUS" = "404" ]; then

    pass "Path traversal protection"

else

    fail "Path traversal protection (HTTP $TRAVERSAL_STATUS)"

fi


# ==========================================
# DELETE TEST FOLDER
# ==========================================

FOLDER_DELETE_RESPONSE=$(
    curl -fsS \
        -b "$COOKIE_FILE" \
        -X DELETE \
        "$BASE_URL/api/files?path=$TEST_FOLDER"
)

if echo "$FOLDER_DELETE_RESPONSE" | grep -q '"message":"Folder deleted successfully"'; then
    pass "Test folder deletion"
else
    fail "Test folder deletion"
    echo "$FOLDER_DELETE_RESPONSE"
fi


# ==========================================
# LOGOUT
# ==========================================

LOGOUT_RESPONSE=$(
    curl -fsS \
        -b "$COOKIE_FILE" \
        -c "$COOKIE_FILE" \
        -X POST \
        "$BASE_URL/api/logout"
)

if echo "$LOGOUT_RESPONSE" | grep -q '"message":"Logged out successfully"'; then
    pass "Logout"
else
    fail "Logout"
fi


# ==========================================
# VERIFY LOGOUT
# ==========================================

LOGGED_OUT_STATUS=$(
    curl -sS \
        -o /dev/null \
        -w "%{http_code}" \
        -b "$COOKIE_FILE" \
        "$BASE_URL/api/me"
)

if [ "$LOGGED_OUT_STATUS" = "401" ]; then
    pass "Logout session invalidation"
else
    fail "Logout session invalidation (HTTP $LOGGED_OUT_STATUS)"
fi


# ==========================================
# CLEANUP
# ==========================================

cleanup


# ==========================================
# FINAL RESULT
# ==========================================

echo
echo "=========================================="
echo "             TEST SUMMARY"
echo "=========================================="
echo
echo "PASSED: $PASS_COUNT"
echo "FAILED: $FAIL_COUNT"
echo

if [ "$FAIL_COUNT" -eq 0 ]; then

    echo "=========================================="
    echo "       ALL AUTOMATED TESTS PASSED"
    echo "=========================================="

    exit 0

else

    echo "=========================================="
    echo "       SOME TESTS FAILED"
    echo "=========================================="

    exit 1

fi
