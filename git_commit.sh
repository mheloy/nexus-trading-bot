#!/bin/bash

# Enhanced Git Workflow Script
# Handles common git operations with interactive prompts

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Check if we're in a git repository
if ! git rev-parse --is-inside-work-tree > /dev/null 2>&1; then
    echo -e "${RED}Error: Not a git repository${NC}"
    exit 1
fi

# Get current branch name
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo -e "${BLUE}=== Git Workflow Manager ===${NC}"
echo -e "${GREEN}Current branch: ${CURRENT_BRANCH}${NC}"
echo -e "${CYAN}Repository: $(basename $(git rev-parse --show-toplevel))${NC}\n"

# Show git status
echo -e "${YELLOW}Status:${NC}"
git status --short
echo ""

# Main menu
echo -e "${YELLOW}Select a git operation:${NC}"
echo "1)  Commit to current branch (${CURRENT_BRANCH})"
echo "2)  Create new branch"
echo "3)  Switch to existing branch"
echo "4)  Commit and merge to main/master"
echo "5)  Pull latest changes"
echo "6)  Push current branch"
echo "7)  View commit history"
echo "8)  Stash changes"
echo "9)  Apply/Pop stash"
echo "10) Delete branch"
echo "11) Sync with remote (fetch + pull)"
echo "12) View branch list"
echo "13) Undo last commit (keep changes)"
echo "14) Show diff"
echo "15) Exit"
read -p "Enter choice [1-15]: " choice

case $choice in
    1)
        # Commit to current branch
        echo -e "\n${YELLOW}=== Commit to Current Branch ===${NC}"

        if git diff-index --quiet HEAD --; then
            echo -e "${YELLOW}No changes to commit${NC}"
            exit 0
        fi

        echo -e "\n${YELLOW}Stage files:${NC}"
        echo "1) All changes (git add -A)"
        echo "2) Modified/deleted only (git add -u)"
        echo "3) Interactive (git add -i)"
        read -p "Choice [1-3]: " stage_choice

        case $stage_choice in
            1) git add -A ;;
            2) git add -u ;;
            3) git add -i ;;
            *) echo -e "${RED}Invalid choice${NC}"; exit 1 ;;
        esac

        echo -e "\n${GREEN}Staged changes:${NC}"
        git status --short

        read -p "\nCommit message: " commit_msg
        if [ -z "$commit_msg" ]; then
            echo -e "${RED}Commit message cannot be empty${NC}"
            exit 1
        fi

        if git commit -m "$commit_msg"; then
            echo -e "${GREEN}✓ Committed to ${CURRENT_BRANCH}${NC}"
            read -p "Push to remote? (y/n): " push_choice
            if [ "$push_choice" = "y" ]; then
                git push origin "$CURRENT_BRANCH" && echo -e "${GREEN}✓ Pushed${NC}"
            fi
        fi
        ;;

    2)
        # Create new branch
        echo -e "\n${YELLOW}=== Create New Branch ===${NC}"
        read -p "New branch name: " new_branch

        if [ -z "$new_branch" ]; then
            echo -e "${RED}Branch name cannot be empty${NC}"
            exit 1
        fi

        echo "Create from:"
        echo "1) Current branch (${CURRENT_BRANCH})"
        echo "2) main/master"
        read -p "Choice [1-2]: " from_choice

        if [ "$from_choice" = "2" ]; then
            if git show-ref --verify --quiet refs/heads/main; then
                git checkout main
            elif git show-ref --verify --quiet refs/heads/master; then
                git checkout master
            else
                echo -e "${RED}Neither main nor master branch exists${NC}"
                exit 1
            fi
            git pull
        fi

        if git checkout -b "$new_branch"; then
            echo -e "${GREEN}✓ Created and switched to branch: ${new_branch}${NC}"
            read -p "Push to remote? (y/n): " push_new
            if [ "$push_new" = "y" ]; then
                git push -u origin "$new_branch" && echo -e "${GREEN}✓ Pushed${NC}"
            fi
        fi
        ;;

    3)
        # Switch branch
        echo -e "\n${YELLOW}=== Switch Branch ===${NC}"
        echo -e "${CYAN}Available branches:${NC}"
        git branch -a
        read -p "\nBranch name to switch to: " switch_branch

        if [ -z "$switch_branch" ]; then
            echo -e "${RED}Branch name cannot be empty${NC}"
            exit 1
        fi

        # Check for uncommitted changes
        if ! git diff-index --quiet HEAD --; then
            echo -e "${YELLOW}You have uncommitted changes${NC}"
            read -p "Stash changes before switching? (y/n): " stash_choice
            if [ "$stash_choice" = "y" ]; then
                git stash
            fi
        fi

        git checkout "$switch_branch" && echo -e "${GREEN}✓ Switched to ${switch_branch}${NC}"
        ;;

    4)
        # Commit and merge to main
        echo -e "\n${YELLOW}=== Commit and Merge to Main/Master ===${NC}"

        if [ "$CURRENT_BRANCH" = "main" ] || [ "$CURRENT_BRANCH" = "master" ]; then
            echo -e "${RED}Already on main/master branch${NC}"
            exit 1
        fi

        # Check for changes
        if ! git diff-index --quiet HEAD --; then
            echo -e "${YELLOW}Committing changes on ${CURRENT_BRANCH}${NC}"
            git add -A
            read -p "Commit message: " merge_commit_msg
            git commit -m "$merge_commit_msg"
            git push origin "$CURRENT_BRANCH"
        fi

        # Determine main branch
        MAIN_BRANCH="main"
        if ! git show-ref --verify --quiet refs/heads/main; then
            MAIN_BRANCH="master"
        fi

        echo -e "${YELLOW}Switching to ${MAIN_BRANCH}${NC}"
        git checkout "$MAIN_BRANCH"
        git pull origin "$MAIN_BRANCH"

        echo -e "${YELLOW}Merging ${CURRENT_BRANCH} into ${MAIN_BRANCH}${NC}"
        if git merge "$CURRENT_BRANCH" --no-ff -m "Merge branch '${CURRENT_BRANCH}' into ${MAIN_BRANCH}"; then
            echo -e "${GREEN}✓ Merged successfully${NC}"
            read -p "Push to remote? (y/n): " push_merge
            if [ "$push_merge" = "y" ]; then
                git push origin "$MAIN_BRANCH" && echo -e "${GREEN}✓ Pushed${NC}"
            fi

            read -p "Delete branch ${CURRENT_BRANCH}? (y/n): " delete_branch
            if [ "$delete_branch" = "y" ]; then
                git branch -d "$CURRENT_BRANCH"
                read -p "Delete remote branch? (y/n): " delete_remote
                if [ "$delete_remote" = "y" ]; then
                    git push origin --delete "$CURRENT_BRANCH"
                fi
            fi
        else
            echo -e "${RED}Merge conflict detected. Resolve conflicts and commit manually.${NC}"
        fi
        ;;

    5)
        # Pull latest changes
        echo -e "\n${YELLOW}=== Pull Latest Changes ===${NC}"
        git pull origin "$CURRENT_BRANCH" && echo -e "${GREEN}✓ Pulled latest changes${NC}"
        ;;

    6)
        # Push current branch
        echo -e "\n${YELLOW}=== Push Current Branch ===${NC}"
        git push origin "$CURRENT_BRANCH" && echo -e "${GREEN}✓ Pushed to origin/${CURRENT_BRANCH}${NC}"
        ;;

    7)
        # View commit history
        echo -e "\n${YELLOW}=== Commit History ===${NC}"
        echo "1) Last 10 commits (compact)"
        echo "2) Last 20 commits (detailed)"
        echo "3) Graph view"
        read -p "Choice [1-3]: " history_choice

        case $history_choice in
            1) git log --oneline -10 ;;
            2) git log -20 ;;
            3) git log --graph --oneline --all -20 ;;
            *) git log --oneline -10 ;;
        esac
        ;;

    8)
        # Stash changes
        echo -e "\n${YELLOW}=== Stash Changes ===${NC}"
        read -p "Stash message (optional): " stash_msg
        if [ -z "$stash_msg" ]; then
            git stash
        else
            git stash save "$stash_msg"
        fi
        echo -e "${GREEN}✓ Changes stashed${NC}"
        git stash list
        ;;

    9)
        # Apply/Pop stash
        echo -e "\n${YELLOW}=== Stash List ===${NC}"
        git stash list
        echo ""
        echo "1) Apply latest stash (keep in stash)"
        echo "2) Pop latest stash (remove from stash)"
        echo "3) Apply specific stash"
        read -p "Choice [1-3]: " stash_choice

        case $stash_choice in
            1) git stash apply && echo -e "${GREEN}✓ Stash applied${NC}" ;;
            2) git stash pop && echo -e "${GREEN}✓ Stash popped${NC}" ;;
            3)
                read -p "Stash number (e.g., 0, 1, 2): " stash_num
                git stash apply stash@{$stash_num} && echo -e "${GREEN}✓ Stash applied${NC}"
                ;;
        esac
        ;;

    10)
        # Delete branch
        echo -e "\n${YELLOW}=== Delete Branch ===${NC}"
        echo -e "${CYAN}Local branches:${NC}"
        git branch
        read -p "\nBranch name to delete: " del_branch

        if [ "$del_branch" = "$CURRENT_BRANCH" ]; then
            echo -e "${RED}Cannot delete current branch. Switch first.${NC}"
            exit 1
        fi

        if [ "$del_branch" = "main" ] || [ "$del_branch" = "master" ]; then
            echo -e "${RED}Cannot delete main/master branch${NC}"
            exit 1
        fi

        git branch -d "$del_branch" 2>/dev/null || git branch -D "$del_branch"

        read -p "Delete from remote as well? (y/n): " del_remote
        if [ "$del_remote" = "y" ]; then
            git push origin --delete "$del_branch"
        fi
        echo -e "${GREEN}✓ Branch deleted${NC}"
        ;;

    11)
        # Sync with remote
        echo -e "\n${YELLOW}=== Sync with Remote ===${NC}"
        echo "Fetching from remote..."
        git fetch --all --prune
        echo "Pulling latest changes..."
        git pull origin "$CURRENT_BRANCH"
        echo -e "${GREEN}✓ Synced with remote${NC}"
        ;;

    12)
        # View branches
        echo -e "\n${YELLOW}=== Branch List ===${NC}"
        echo -e "${CYAN}Local branches:${NC}"
        git branch
        echo -e "\n${CYAN}Remote branches:${NC}"
        git branch -r
        ;;

    13)
        # Undo last commit
        echo -e "\n${YELLOW}=== Undo Last Commit ===${NC}"
        echo "Last commit:"
        git log -1 --oneline
        read -p "\nUndo this commit (keep changes)? (y/n): " undo_confirm
        if [ "$undo_confirm" = "y" ]; then
            git reset --soft HEAD~1
            echo -e "${GREEN}✓ Commit undone (changes kept in staging)${NC}"
        fi
        ;;

    14)
        # Show diff
        echo -e "\n${YELLOW}=== Show Differences ===${NC}"
        echo "1) Unstaged changes"
        echo "2) Staged changes"
        echo "3) Last commit"
        read -p "Choice [1-3]: " diff_choice

        case $diff_choice in
            1) git diff ;;
            2) git diff --staged ;;
            3) git show HEAD ;;
            *) git diff ;;
        esac
        ;;

    15)
        echo "Exiting..."
        exit 0
        ;;

    *)
        echo -e "${RED}Invalid choice${NC}"
        exit 1
        ;;
esac
