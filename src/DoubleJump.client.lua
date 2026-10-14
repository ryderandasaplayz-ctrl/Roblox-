-- LocalScript in StarterPlayer > StarterPlayerScripts. Works on mobile too (jump button).
local Players = game:GetService("Players")
local UIS = game:GetService("UserInputService")
local plr = Players.LocalPlayer
local canDouble = false

local function hook(char)
	local h = char:WaitForChild("Humanoid")
	h.StateChanged:Connect(function(_, new)
		if new == Enum.HumanoidStateType.Landed then canDouble = false
		elseif new == Enum.HumanoidStateType.Freefall then task.wait(0.15); canDouble = true end
	end)
end
if plr.Character then hook(plr.Character) end
plr.CharacterAdded:Connect(hook)

UIS.JumpRequest:Connect(function()
	local char = plr.Character
	local h = char and char:FindFirstChildOfClass("Humanoid")
	if h and canDouble and plr:GetAttribute("DoubleJump") then
		canDouble = false
		h:ChangeState(Enum.HumanoidStateType.Jumping)
	end
end)
